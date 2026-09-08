-- =====================================================================
-- Solvix Tender Desk - business functions, triggers and views
-- =====================================================================
-- Everything here depends on the tables from 20260101000000 and the identity
-- helpers (current_profile_id / is_active_member / is_admin) defined there.
-- =====================================================================

-- =====================================================================
-- load_number generation
-- =====================================================================
-- Format: S<YY><5-digit sequence>, e.g. S2600001. The sequence is global
-- rather than per-year on purpose: a gap-free per-year counter would need a
-- lock, and dispatchers care that the number is short and unique, not that it
-- restarts in January.
create or replace function public.tg_loads_assign_number()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.load_number is null or btrim(new.load_number) = '' then
    new.load_number := 'S'
      || to_char(now(), 'YY')
      || lpad(nextval('public.load_number_seq')::text, 5, '0');
  end if;
  return new;
end;
$$;

create trigger loads_assign_number
  before insert on public.loads
  for each row execute function public.tg_loads_assign_number();

-- =====================================================================
-- Stage transitions: stamp the per-stage timestamp, keep last_touched_at
-- fresh, and append to load_status_history.
-- =====================================================================
create or replace function public.tg_loads_before_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_key text;
begin
  -- Any edit counts as a touch, unless the caller set last_touched_at itself
  -- (which is how the tracking-event trigger stamps its own time).
  if new.last_touched_at is not distinct from old.last_touched_at then
    new.last_touched_at := now();
  end if;

  if new.pipeline_stage_id is distinct from old.pipeline_stage_id then
    select ps.key into v_key
    from public.pipeline_stages ps
    where ps.id = new.pipeline_stage_id;

    -- coalesce() so re-entering a stage keeps the ORIGINAL time it was first
    -- reached; a load that bounces back to 'booked' should not lose booked_at.
    case v_key
      when 'booked'            then new.booked_at       := coalesce(new.booked_at, now());
      when 'appointment_set'   then new.appt_set_at     := coalesce(new.appt_set_at, now());
      when 'appointment_ready' then new.appt_ready_at   := coalesce(new.appt_ready_at, now());
      when 'in_transit'        then new.in_transit_at   := coalesce(new.in_transit_at, now());
      when 'delivered'         then new.delivered_at    := coalesce(new.delivered_at, now());
      when 'pod_received'      then new.pod_received_at := coalesce(new.pod_received_at, now());
      when 'invoiced'          then new.invoiced_at     := coalesce(new.invoiced_at, now());
      when 'paid'              then new.paid_at         := coalesce(new.paid_at, now());
      when 'cancelled'         then new.cancelled_at    := coalesce(new.cancelled_at, now());
      else null;  -- 'new', 'qc_review', 'available' have no stamp column
    end case;
  end if;

  return new;
end;
$$;

create trigger loads_before_update
  before update on public.loads
  for each row execute function public.tg_loads_before_update();

create or replace function public.tg_loads_after_stage_change()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    -- Seed the timeline so a load's history starts where the load did,
    -- instead of the first row being an unexplained jump out of nowhere.
    insert into public.load_status_history (load_id, from_stage_id, to_stage_id, changed_by)
    values (new.id, null, new.pipeline_stage_id, public.current_profile_id());
  elsif new.pipeline_stage_id is distinct from old.pipeline_stage_id then
    insert into public.load_status_history (load_id, from_stage_id, to_stage_id, changed_by)
    values (new.id, old.pipeline_stage_id, new.pipeline_stage_id, public.current_profile_id());
  end if;
  return null;
end;
$$;

create trigger loads_after_insert_history
  after insert on public.loads
  for each row execute function public.tg_loads_after_stage_change();

create trigger loads_after_stage_change
  after update of pipeline_stage_id on public.loads
  for each row execute function public.tg_loads_after_stage_change();

-- =====================================================================
-- Tracking events bump the parent load's last_touched_at
-- =====================================================================
create or replace function public.tg_tracking_touch_load()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  update public.loads
     set last_touched_at = now()
   where id = new.load_id;
  return new;
end;
$$;

create trigger load_tracking_events_touch_load
  after insert on public.load_tracking_events
  for each row execute function public.tg_tracking_touch_load();

-- =====================================================================
-- load_stops -> loads rollup
-- =====================================================================
-- The load board reads first_pickup_at / origin_* / dest_* straight off
-- `loads`. Without this it would be a join plus an aggregate per row on every
-- board refresh.
create or replace function public.recompute_load_stop_rollup(p_load_id uuid)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_first_pickup  timestamptz;
  v_last_delivery timestamptz;
  v_o_city  text; v_o_state text; v_o_metro uuid;
  v_d_city  text; v_d_state text; v_d_metro uuid;
begin
  if p_load_id is null then
    return;
  end if;

  -- The parent is already gone when this fires from an ON DELETE CASCADE.
  if not exists (select 1 from public.loads where id = p_load_id) then
    return;
  end if;

  -- A confirmed appointment beats the tender's window.
  select min(coalesce(s.appointment, s.earliest, s.latest))
    into v_first_pickup
    from public.load_stops s
   where s.load_id = p_load_id and s.stop_type = 'pickup';

  select max(coalesce(s.appointment, s.latest, s.earliest))
    into v_last_delivery
    from public.load_stops s
   where s.load_id = p_load_id and s.stop_type = 'delivery';

  -- Origin = first pickup by sequence; falls back to the first stop of any
  -- type so a half-parsed tender still shows something on the board.
  select s.city, s.state, s.metro_id
    into v_o_city, v_o_state, v_o_metro
    from public.load_stops s
   where s.load_id = p_load_id
   order by (s.stop_type = 'pickup') desc,
            coalesce(s.sequence, 2147483647) asc,
            s.created_at asc
   limit 1;

  -- Destination = last delivery by sequence, same fallback.
  select s.city, s.state, s.metro_id
    into v_d_city, v_d_state, v_d_metro
    from public.load_stops s
   where s.load_id = p_load_id
   order by (s.stop_type = 'delivery') desc,
            coalesce(s.sequence, -2147483648) desc,
            s.created_at desc
   limit 1;

  update public.loads l
     set first_pickup_at  = v_first_pickup,
         last_delivery_at = v_last_delivery,
         origin_city      = v_o_city,
         origin_state     = v_o_state,
         origin_metro_id  = v_o_metro,
         dest_city        = v_d_city,
         dest_state       = v_d_state,
         dest_metro_id    = v_d_metro
   where l.id = p_load_id
     -- Skip the write (and the last_touched_at bump it would cause) when
     -- nothing actually moved.
     and (l.first_pickup_at  is distinct from v_first_pickup
       or l.last_delivery_at is distinct from v_last_delivery
       or l.origin_city      is distinct from v_o_city
       or l.origin_state     is distinct from v_o_state
       or l.origin_metro_id  is distinct from v_o_metro
       or l.dest_city        is distinct from v_d_city
       or l.dest_state       is distinct from v_d_state
       or l.dest_metro_id    is distinct from v_d_metro);
end;
$$;

comment on function public.recompute_load_stop_rollup(uuid) is
  'Recomputes the denormalised stop columns on loads. Called by the
   load_stops trigger; safe to call by hand to repair a row.';

create or replace function public.tg_load_stops_rollup()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    perform public.recompute_load_stop_rollup(old.load_id);
    return old;
  end if;

  perform public.recompute_load_stop_rollup(new.load_id);

  -- A stop moved between loads: both parents need recomputing.
  if tg_op = 'UPDATE' and old.load_id is distinct from new.load_id then
    perform public.recompute_load_stop_rollup(old.load_id);
  end if;

  return new;
end;
$$;

create trigger load_stops_rollup
  after insert or update or delete on public.load_stops
  for each row execute function public.tg_load_stops_rollup();

-- =====================================================================
-- Metro resolution
-- =====================================================================
-- Single canonical implementation, shared by the ingest Edge Function (over
-- RPC) and by the QC screen in the app. Resolution order:
--   1. city matches a metro's own name       ('Atlanta'   -> 'Atlanta, GA')
--   2. city matches one of its aliases       ('Marietta'  -> 'Atlanta, GA')
--   3. exact 5-digit ZIP                     (carve-outs: Laredo, Yuma, ...)
--   4. 3-digit ZIP prefix
-- Returns NULL rather than guessing when nothing matches.
create or replace function public.resolve_metro(
  p_city   text,
  p_state  text,
  p_postal text default null
)
returns uuid
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_city  text := nullif(btrim(coalesce(p_city, '')), '');
  v_state text := upper(nullif(btrim(coalesce(p_state, '')), ''));
  v_zip   text := regexp_replace(coalesce(p_postal, ''), '[^0-9]', '', 'g');
  v_id    uuid;
begin
  if v_city is not null then
    -- 1. the metro's own city name, e.g. 'Atlanta' in 'Atlanta, GA'
    select m.id into v_id
      from public.metros m
     where m.active
       and lower(split_part(m.name, ',', 1)) = lower(v_city)
       and (v_state is null or upper(coalesce(m.state, '')) = v_state)
     order by m.name
     limit 1;
    if v_id is not null then
      return v_id;
    end if;

    -- 2. an alias. Aliases for out-of-state suburbs carry their state
    --    ('Gary IN'), which is how they match without the metro's own state
    --    agreeing.
    select m.id into v_id
      from public.metros m
     where m.active
       and exists (
             select 1 from unnest(m.aliases) a
              where lower(a) = lower(v_city)
                 or (v_state is not null and lower(a) = lower(v_city || ' ' || v_state))
           )
       and (
             v_state is null
             or upper(coalesce(m.state, '')) = v_state
             or exists (
                  select 1 from unnest(m.aliases) a
                   where lower(a) = lower(v_city || ' ' || v_state)
                )
           )
     order by m.name
     limit 1;
    if v_id is not null then
      return v_id;
    end if;
  end if;

  -- 3. exact ZIP5 (beats zip3 - that is the point of the carve-out rows)
  if length(v_zip) >= 5 then
    select z.metro_id into v_id
      from public.metro_zip_map z
     where z.zip5 = left(v_zip, 5)
     limit 1;
    if v_id is not null then
      return v_id;
    end if;
  end if;

  -- 4. ZIP3 prefix
  if length(v_zip) >= 3 then
    select z.metro_id into v_id
      from public.metro_zip_map z
     where z.zip3 = left(v_zip, 3)
       and z.zip5 is null
     limit 1;
    if v_id is not null then
      return v_id;
    end if;
  end if;

  return null;
end;
$$;

comment on function public.resolve_metro(text, text, text) is
  'City/state/ZIP -> metros.id, or NULL. Canonical implementation; the ingest
   Edge Function calls this over RPC rather than reimplementing it.';

-- =====================================================================
-- customer_location_history
-- =====================================================================
create or replace function public.normalize_location_key(
  p_name     text,
  p_address1 text,
  p_city     text,
  p_state    text,
  p_postal   text
)
returns text
language sql
immutable
as $$
  -- `||` rather than concat_ws(): concat_ws is only STABLE, which would make
  -- this function's IMMUTABLE marking a lie and break any index built on it.
  select lower(
    regexp_replace(
      coalesce(p_name, '')     || '|' ||
      coalesce(p_address1, '') || '|' ||
      coalesce(p_city, '')     || '|' ||
      coalesce(p_state, '')    || '|' ||
      coalesce(p_postal, ''),
      '[^a-zA-Z0-9|]', '', 'g'
    )
  );
$$;

comment on function public.normalize_location_key(text, text, text, text, text) is
  'Dedupe key for customer_location_history: lowercased, punctuation and
   whitespace stripped, pipe-separated so "1 Main St" and "11 Ain St" cannot
   collide across field boundaries.';

create or replace function public.upsert_customer_location(
  p_customer_id uuid,
  p_role        text,
  p_name        text default null,
  p_address1    text default null,
  p_city        text default null,
  p_state       text default null,
  p_postal      text default null,
  p_metro_id    uuid default null
)
returns uuid
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_key text;
  v_id  uuid;
begin
  if p_customer_id is null then
    raise exception 'upsert_customer_location: p_customer_id is required';
  end if;
  if p_role is null then
    raise exception 'upsert_customer_location: p_role is required';
  end if;

  v_key := public.normalize_location_key(p_name, p_address1, p_city, p_state, p_postal);

  -- Four bare pipes = every field was empty. Counting that as a location
  -- would merge every blank stop a customer ever had into one row.
  if v_key = '||||' then
    raise exception 'upsert_customer_location: at least one location field must be supplied';
  end if;

  insert into public.customer_location_history
    (customer_id, role, name, address1, city, state, postal, metro_id, normalized_key)
  values
    (p_customer_id, p_role, p_name, p_address1, p_city, p_state, p_postal, p_metro_id, v_key)
  on conflict (customer_id, role, normalized_key) do update
    set use_count    = customer_location_history.use_count + 1,
        last_used_at = now(),
        -- Only fill gaps; never blank out something we already knew.
        name         = coalesce(excluded.name,     customer_location_history.name),
        address1     = coalesce(excluded.address1, customer_location_history.address1),
        city         = coalesce(excluded.city,     customer_location_history.city),
        state        = coalesce(excluded.state,    customer_location_history.state),
        postal       = coalesce(excluded.postal,   customer_location_history.postal),
        metro_id     = coalesce(excluded.metro_id, customer_location_history.metro_id)
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.upsert_customer_location(uuid, text, text, text, text, text, text, uuid) is
  'Records a confirmed location for a customer, incrementing use_count and
   bumping last_used_at when it has been seen before. Called from the QC screen.';

-- =====================================================================
-- Views
-- =====================================================================
-- security_invoker so the underlying RLS policies still apply. Without it a
-- view runs as its owner and would hand every row to every caller.

-- ---------------------------------------------------------------------
-- v_load_board - one row per load, everything the board renders
-- ---------------------------------------------------------------------
-- Deliberately a plain view, not materialized: the urgency colours are a
-- function of now() versus first_pickup_at, so a stale snapshot would show
-- the wrong colour, which is the one thing this screen exists to get right.
--
-- NOTE: `l.*` freezes the column list at creation time. Adding a column to
-- `loads` later needs a `create or replace view` to surface it here.
create view public.v_load_board
with (security_invoker = true) as
select
  l.*,
  -- Consistently `stage_`-prefixed: on a load row, a bare `is_booked` reads as
  -- a property of the load rather than of its stage.
  ps.key        as stage_key,
  ps.label      as stage_label,
  ps.sort_order as stage_sort_order,
  ps.is_booked  as stage_is_booked,
  ps.is_terminal as stage_is_terminal,
  cu.name       as customer_name,
  ca.name       as carrier_name,
  ca.dot_number as carrier_dot_number,
  ca.status     as carrier_status,
  om.name       as origin_metro_name,
  dm.name       as dest_metro_name,
  coalesce(fl.open_flag_count, 0) as open_flag_count,
  -- Booked urgency keys off these two.
  (tr.latest_tracking_at is not null) as has_tracking_event,
  tr.latest_tracking_at,
  (cc.latest_check_call_at is not null) as has_check_call,
  cc.latest_check_call_at
from public.loads l
join public.pipeline_stages ps on ps.id = l.pipeline_stage_id
left join public.customers cu  on cu.id = l.customer_id
left join public.carriers  ca  on ca.id = l.carrier_id
left join public.metros    om  on om.id = l.origin_metro_id
left join public.metros    dm  on dm.id = l.dest_metro_id
left join lateral (
  select count(*)::int as open_flag_count
    from public.load_flags f
   where f.load_id = l.id and f.resolved_at is null
) fl on true
left join lateral (
  select max(e.created_at) as latest_tracking_at
    from public.load_tracking_events e
   where e.load_id = l.id
) tr on true
left join lateral (
  select max(e.created_at) as latest_check_call_at
    from public.load_tracking_events e
   where e.load_id = l.id and e.type = 'check_call'
) cc on true;

comment on view public.v_load_board is
  'The load board query. One row per load with stage, parties, open flag count
   and tracking presence already joined, so the board is a single select.';

-- ---------------------------------------------------------------------
-- v_carrier_recent_interactions
-- ---------------------------------------------------------------------
-- age_bucket turns the UI rule ("pop up recent history, show a caution icon
-- for anything in the last year") into a plain filter.
--
-- NOTE: the 30-day / 1-year windows are hard-coded here to keep the view
-- indexable and cheap. They duplicate org_settings.interaction_aging - if an
-- admin edits that JSON, this view does NOT follow. Either keep them in sync
-- or have the app bucket client-side from created_at.
create view public.v_carrier_recent_interactions
with (security_invoker = true) as
select
  ci.id,
  ci.carrier_id,
  ci.load_id,
  l.load_number,
  ci.interaction_type_id,
  it.key      as interaction_type_key,
  it.label    as interaction_type_label,
  it.severity,
  ci.body,
  ci.created_by,
  p.full_name as created_by_name,
  ci.created_at,
  case
    when ci.created_at >= now() - interval '30 days' then 'recent'
    when ci.created_at >= now() - interval '1 year'  then 'caution'
    else 'archive'
  end as age_bucket
from public.carrier_interactions ci
left join public.interaction_types it on it.id = ci.interaction_type_id
left join public.loads l              on l.id  = ci.load_id
left join public.profiles p           on p.id  = ci.created_by;

comment on view public.v_carrier_recent_interactions is
  'Carrier interaction log with a precomputed recent / caution / archive
   bucket for the carrier pop-up.';

-- ---------------------------------------------------------------------
-- Grants on the new views and functions
-- ---------------------------------------------------------------------
grant select on public.v_load_board                 to authenticated;
grant select on public.v_carrier_recent_interactions to authenticated;
grant select on public.v_load_board                 to service_role;
grant select on public.v_carrier_recent_interactions to service_role;

grant execute on function public.resolve_metro(text, text, text) to authenticated, service_role;
grant execute on function public.upsert_customer_location(uuid, text, text, text, text, text, text, uuid)
  to authenticated, service_role;
grant execute on function public.normalize_location_key(text, text, text, text, text)
  to authenticated, service_role;
grant execute on function public.recompute_load_stop_rollup(uuid) to service_role;
