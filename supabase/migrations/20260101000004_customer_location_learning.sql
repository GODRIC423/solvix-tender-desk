-- =====================================================================
-- Wire up customer location learning
-- =====================================================================
-- `upsert_customer_location()` existed but nothing ever called it, so
-- `customer_location_history` stayed empty forever and the "use a location
-- this customer has used before" dropdowns never appeared. That is the
-- feature that makes a low-confidence extraction a one-click fix instead of
-- a retype, so it needs to populate itself.
--
-- This runs in the database rather than in the app on purpose: loads arrive
-- from the connector, from the ingest function, and from dispatchers editing
-- the board. A trigger cannot be forgotten by one of those paths.
--
-- WHEN IT COUNTS
-- The meaningful moment is when a human confirms which customer a load
-- belongs to at QC - before that, `loads.customer_id` is null and we have
-- nothing to attribute a location to. So:
--
--   1. loads.customer_id set or changed -> record every stop on the load
--   2. a stop's location genuinely changes on a load that already has a
--      customer -> record the new location
--
-- KNOWN IMPRECISION: `use_count` approximates "how many loads used this
-- location". A dispatcher who edits one stop's address twice in two separate
-- saves adds two counts. Ranking is by use_count then last_used_at, so a
-- small over-count changes nothing a user would notice; making it exact
-- would mean tracking contribution per (load, stop), which is not worth the
-- extra table today.
-- =====================================================================

-- A stop's role in the customer's own vocabulary: where they ship FROM is a
-- pickup, where they ship TO is a delivery.
create or replace function public.stop_role_for_history(p_stop_type text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when p_stop_type = 'pickup'   then 'pickup'
    when p_stop_type = 'delivery' then 'delivery'
    else null
  end;
$$;

comment on function public.stop_role_for_history(text) is
  'Maps load_stops.stop_type onto customer_location_history.role. Returns null
   for ''other'' stops, which are not worth learning.';

-- ---------------------------------------------------------------------
-- Record every stop on a load, ignoring ones with nothing to learn.
-- ---------------------------------------------------------------------
create or replace function public.record_load_locations(p_load_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_customer_id uuid;
  v_role        text;
  v_recorded    integer := 0;
  r             record;
begin
  select customer_id into v_customer_id from public.loads where id = p_load_id;
  if v_customer_id is null then
    return 0;
  end if;

  for r in
    select name, address1, city, state, postal, metro_id, stop_type
      from public.load_stops
     where load_id = p_load_id
  loop
    v_role := public.stop_role_for_history(r.stop_type);
    continue when v_role is null;

    -- Skip stops with no location at all; upsert_customer_location would
    -- raise on them and take the whole transaction down with it.
    continue when public.normalize_location_key(
                    r.name, r.address1, r.city, r.state, r.postal) = '||||';

    perform public.upsert_customer_location(
      v_customer_id, v_role, r.name, r.address1, r.city, r.state, r.postal, r.metro_id);
    v_recorded := v_recorded + 1;
  end loop;

  return v_recorded;
end;
$$;

comment on function public.record_load_locations(uuid) is
  'Records each of a load''s stops against its customer''s location history.
   No-op when the load has no customer yet.';

-- ---------------------------------------------------------------------
-- 1. The QC moment: a load gets its customer.
-- ---------------------------------------------------------------------
create or replace function public.tg_loads_learn_locations()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.customer_id is not null
     and new.customer_id is distinct from old.customer_id
  then
    perform public.record_load_locations(new.id);
  end if;
  return null;
end;
$$;

create trigger loads_learn_locations
  after update of customer_id on public.loads
  for each row execute function public.tg_loads_learn_locations();

-- ---------------------------------------------------------------------
-- 2. A stop's location actually changes on a load that has a customer.
-- ---------------------------------------------------------------------
create or replace function public.tg_load_stops_learn_location()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_customer_id uuid;
  v_role        text;
  v_new_key     text;
begin
  select customer_id into v_customer_id from public.loads where id = new.load_id;
  if v_customer_id is null then
    return null;
  end if;

  v_role := public.stop_role_for_history(new.stop_type);
  if v_role is null then
    return null;
  end if;

  v_new_key := public.normalize_location_key(
                 new.name, new.address1, new.city, new.state, new.postal);
  if v_new_key = '||||' then
    return null;
  end if;

  -- On UPDATE, only learn when the location genuinely moved. Re-saving the
  -- same stop (a rate edit, an appointment change) must not inflate counts.
  if tg_op = 'UPDATE' then
    if v_new_key = public.normalize_location_key(
                     old.name, old.address1, old.city, old.state, old.postal) then
      return null;
    end if;
  end if;

  perform public.upsert_customer_location(
    v_customer_id, v_role, new.name, new.address1, new.city, new.state, new.postal, new.metro_id);
  return null;
end;
$$;

create trigger load_stops_learn_location
  after insert or update of name, address1, city, state, postal, stop_type
  on public.load_stops
  for each row execute function public.tg_load_stops_learn_location();

-- ---------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------
grant execute on function public.stop_role_for_history(text) to authenticated, service_role;
grant execute on function public.record_load_locations(uuid)  to authenticated, service_role;
