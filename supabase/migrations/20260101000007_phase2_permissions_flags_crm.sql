-- =====================================================================
-- Phase 2: permissions, toggleable flags, teams, customer CRM, reports
-- =====================================================================
-- First-use feedback from the desk's owner. The themes, in their words:
--
--   * "There's no way to actually add a load" - everything had to arrive as
--     a dropped tender. Manual creation needs to exist, and so does a way to
--     make a throwaway test load to poke at.
--   * "Toggle on, toggle off ... call it flags instead" - the urgency rules
--     were a wall of number inputs. Each tier becomes a switch with an hour
--     cutoff behind it, and the switches can differ per team or per user:
--     the check-call team wants booked loads and nothing else.
--   * "Gate what people can and can't do" - a permission model with real
--     server-side enforcement on the paths that matter (bulk import), and
--     an admin-only export.
--   * Customers need a real profile: links, social, and an activity log, so
--     "what's new with them" is answerable from inside the desk.
--   * A reports page: run rate, profit per load, margin, runway.
--
-- Everything additive. No existing column is renamed or dropped; the old
-- urgency_rules JSON is migrated into the new flag_rules shape in place.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. profiles: team, per-user permissions, per-user view preferences
-- ---------------------------------------------------------------------
alter table public.profiles
  add column if not exists team        text,
  add column if not exists permissions jsonb not null default '{}'::jsonb,
  add column if not exists preferences jsonb not null default '{}'::jsonb;

comment on column public.profiles.team is
  'Free-form team key (dispatch, check_call, sales, billing). Selects the
   team-level defaults in org_settings.team_defaults.';
comment on column public.profiles.permissions is
  'Per-user permission overrides: {"export_carriers": true}. Anything absent
   falls through to org_settings.role_permissions for the user''s role.';
comment on column public.profiles.preferences is
  'Per-user UI preferences (board view, which flag tiers fire). Overrides
   team defaults, which override org defaults.';

create index if not exists profiles_team_idx on public.profiles (team) where team is not null;

-- Extend the privilege guard: team and permissions are admin-only too. A
-- dispatcher editing their own display name must not be able to grant
-- themselves export rights in the same request.
create or replace function public.tg_profiles_guard_privileged_columns()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if (new.role        is distinct from old.role
      or new.active   is distinct from old.active
      or new.team     is distinct from old.team
      or new.permissions is distinct from old.permissions)
     and not public.is_admin()
     and auth.uid() is not null
  then
    raise exception 'only an admin may change profiles.role, active, team or permissions'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- 2. org_settings: flag rules, team defaults, role permissions, finance
-- ---------------------------------------------------------------------
alter table public.org_settings
  add column if not exists flag_rules       jsonb not null default '{}'::jsonb,
  add column if not exists team_defaults    jsonb not null default '{}'::jsonb,
  add column if not exists role_permissions jsonb not null default '{}'::jsonb,
  add column if not exists cash_on_hand     numeric(14,2),
  add column if not exists monthly_overhead numeric(14,2);

comment on column public.org_settings.flag_rules is
  'Replaces urgency_rules. Each tier is {enabled, hours} so a tier can be
   switched off without losing its cutoff. Shape:
   {"unbooked": {"enabled": true,
                 "yellow": {"enabled": true, "hours": 72},
                 "orange": {"enabled": true, "hours": 24},
                 "red":    {"enabled": true, "hours": 3}},
    "booked":   {"enabled": true,
                 "red_no_checkcall":    {"enabled": true, "hours": 2},
                 "orange_no_checkcall": {"enabled": true, "hours": 6},
                 "stale":               {"enabled": true, "hours": 24}}}';
comment on column public.org_settings.team_defaults is
  'Per-team view defaults keyed by profiles.team, e.g.
   {"check_call": {"show_unbooked": false, "show_booked": true}}.
   A user''s own preferences override these.';
comment on column public.org_settings.role_permissions is
  'Default permission set per role. profiles.permissions overrides per user.
   Read by has_permission() on the server and by the app - one source.';
comment on column public.org_settings.cash_on_hand is
  'Operating cash, entered by an admin. Runway on the reports page is this
   divided by monthly net burn. Null hides the runway tile rather than
   showing a made-up number.';
comment on column public.org_settings.monthly_overhead is
  'Fixed monthly costs (payroll, software, insurance) excluding carrier pay,
   which is already netted out of load margin.';

-- Carry the existing urgency hours into the new shape so nobody''s tuned
-- cutoffs are lost. Only fills flag_rules where it is still empty.
update public.org_settings
   set flag_rules = jsonb_build_object(
     'unbooked', jsonb_build_object(
       'enabled', true,
       'yellow', jsonb_build_object('enabled', true,
                   'hours', coalesce((urgency_rules #>> '{unbooked,yellow_hours}')::numeric, 72)),
       'orange', jsonb_build_object('enabled', true,
                   'hours', coalesce((urgency_rules #>> '{unbooked,orange_hours}')::numeric, 24)),
       'red',    jsonb_build_object('enabled', true,
                   'hours', coalesce((urgency_rules #>> '{unbooked,red_hours}')::numeric, 3))
     ),
     'booked', jsonb_build_object(
       'enabled', true,
       'red_no_checkcall',    jsonb_build_object('enabled', true,
                   'hours', coalesce((urgency_rules #>> '{booked,red_hours_no_checkcall}')::numeric, 2)),
       'orange_no_checkcall', jsonb_build_object('enabled', true,
                   'hours', coalesce((urgency_rules #>> '{booked,orange_hours_no_checkcall}')::numeric, 6)),
       'stale',               jsonb_build_object('enabled', true,
                   'hours', coalesce((urgency_rules #>> '{booked,stale_touch_hours}')::numeric, 24))
     )
   )
 where id = 1 and flag_rules = '{}'::jsonb;

-- The check-call team is the example the owner gave: they call drivers on
-- booked loads and have no use for the unbooked board.
update public.org_settings
   set team_defaults = jsonb_build_object(
     'check_call', jsonb_build_object('show_unbooked', false, 'show_booked', true),
     'dispatch',   jsonb_build_object('show_unbooked', true,  'show_booked', true),
     'sales',      jsonb_build_object('show_unbooked', true,  'show_booked', false),
     'billing',    jsonb_build_object('show_unbooked', false, 'show_booked', true)
   )
 where id = 1 and team_defaults = '{}'::jsonb;

-- Default permissions per role. Admin is not listed: has_permission()
-- short-circuits to true for admins so a new key can never lock them out.
update public.org_settings
   set role_permissions = jsonb_build_object(
     'dispatcher', jsonb_build_object(
       'create_loads',     true,
       'edit_loads',       true,
       'delete_loads',     false,
       'import_carriers',  true,
       'export_carriers',  false,
       'import_customers', true,
       'export_customers', false,
       'view_reports',     false,
       'manage_users',     false,
       'manage_settings',  false
     ),
     'viewer', jsonb_build_object(
       'create_loads',     false,
       'edit_loads',       false,
       'delete_loads',     false,
       'import_carriers',  false,
       'export_carriers',  false,
       'import_customers', false,
       'export_customers', false,
       'view_reports',     false,
       'manage_users',     false,
       'manage_settings',  false
     )
   )
 where id = 1 and role_permissions = '{}'::jsonb;

-- ---------------------------------------------------------------------
-- 3. has_permission() - the one place authorization is decided
-- ---------------------------------------------------------------------
-- Resolution: admin -> true; else the user''s own override if present; else
-- the role default; else false. SECURITY DEFINER for the same reason as
-- is_admin(): it reads profiles and org_settings from inside RLS policies.
create or replace function public.has_permission(p_key text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_role  text;
  v_perms jsonb;
  v_own   jsonb;
  v_role_default jsonb;
begin
  if auth.uid() is null then
    return false;
  end if;

  select p.role, p.permissions
    into v_role, v_perms
    from public.profiles p
   where p.id = auth.uid() and p.active;

  if v_role is null then
    return false;
  end if;
  if v_role = 'admin' then
    return true;
  end if;

  v_own := v_perms -> p_key;
  if v_own is not null and jsonb_typeof(v_own) = 'boolean' then
    return v_own::boolean;
  end if;

  select o.role_permissions -> v_role -> p_key
    into v_role_default
    from public.org_settings o
   where o.id = 1;

  if v_role_default is not null and jsonb_typeof(v_role_default) = 'boolean' then
    return v_role_default::boolean;
  end if;

  return false;
end;
$$;

comment on function public.has_permission(text) is
  'True when the calling user holds a permission. Admins always do. Checks
   profiles.permissions first, then org_settings.role_permissions.';

grant execute on function public.has_permission(text) to authenticated;

-- ---------------------------------------------------------------------
-- 4. loads.is_test - a load you can poke at without polluting the numbers
-- ---------------------------------------------------------------------
alter table public.loads
  add column if not exists is_test boolean not null default false;

comment on column public.loads.is_test is
  'Created from the "make a test load" button. Shown with a badge on the
   board and excluded from every report.';

create index if not exists loads_is_test_idx on public.loads (is_test) where is_test;

-- ---------------------------------------------------------------------
-- 4a. pipeline_stages.phase - where in its life a load is
-- ---------------------------------------------------------------------
-- The booked-load flags ask "is anyone watching this before it picks up?".
-- That question stops making sense the moment the truck is rolling, and a
-- delivered load flagged red for "no check call before pickup" is noise
-- that buries the loads that actually need a call. is_booked/is_terminal
-- cannot express "in transit" or "delivered but not yet paid", so every
-- stage gets a phase and the flag rules read that instead.
alter table public.pipeline_stages
  add column if not exists phase text not null default 'pre_pickup'
    check (phase in ('pre_booking', 'pre_pickup', 'in_transit', 'post_delivery', 'closed'));

comment on column public.pipeline_stages.phase is
  'pre_booking: needs a carrier (unbooked flags). pre_pickup: carrier on it,
   truck not yet loaded (booked flags). in_transit: rolling (only the
   gone-quiet flag). post_delivery: billing stages, no board flags. closed:
   paid or cancelled.';

update public.pipeline_stages set phase = case key
  when 'new'               then 'pre_booking'
  when 'qc_review'         then 'pre_booking'
  when 'available'         then 'pre_booking'
  when 'booked'            then 'pre_pickup'
  when 'appointment_set'   then 'pre_pickup'
  when 'appointment_ready' then 'pre_pickup'
  when 'in_transit'        then 'in_transit'
  when 'delivered'         then 'post_delivery'
  when 'pod_received'      then 'post_delivery'
  when 'invoiced'          then 'post_delivery'
  when 'paid'              then 'closed'
  when 'cancelled'         then 'closed'
  else phase
end;

-- The board view freezes `l.*` at creation, so it has to be recreated to
-- pick up is_test. DROP rather than OR REPLACE: the new column lands in the
-- middle of the column list (inside `l.*`), and Postgres refuses to let
-- OR REPLACE shift existing columns. Nothing else depends on this view.
-- Same definition otherwise.
drop view if exists public.v_load_board;
create view public.v_load_board
with (security_invoker = true) as
select
  l.*,
  ps.key        as stage_key,
  ps.label      as stage_label,
  ps.sort_order as stage_sort_order,
  ps.is_booked  as stage_is_booked,
  ps.is_terminal as stage_is_terminal,
  ps.phase      as stage_phase,
  cu.name       as customer_name,
  ca.name       as carrier_name,
  ca.dot_number as carrier_dot_number,
  ca.status     as carrier_status,
  om.name       as origin_metro_name,
  dm.name       as dest_metro_name,
  coalesce(fl.open_flag_count, 0) as open_flag_count,
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

-- Grants do not survive a DROP.
grant select on public.v_load_board to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 5. customers: the profile a sales desk actually wants
-- ---------------------------------------------------------------------
alter table public.customers
  add column if not exists website          text,
  add column if not exists linkedin_url     text,
  add column if not exists facebook_url     text,
  add column if not exists instagram_url    text,
  add column if not exists x_url            text,
  add column if not exists quick_links      jsonb not null default '[]'::jsonb,
  add column if not exists industry         text,
  add column if not exists account_owner_id uuid references public.profiles(id) on delete set null,
  add column if not exists last_activity_at timestamptz;

comment on column public.customers.quick_links is
  'Array of {"label": "Portal", "url": "https://..."} - the pages a rep opens
   for this account every day (load portal, invoice site, ...).';
comment on column public.customers.last_activity_at is
  'Latest of: a load assigned to them, an interaction logged. Maintained by
   trigger. The customer list sorts and greys on this so quiet accounts are
   visible at a glance.';

create index if not exists customers_last_activity_idx
  on public.customers (last_activity_at desc nulls last);
create index if not exists customers_owner_idx
  on public.customers (account_owner_id) where account_owner_id is not null;

-- Activity log. Mirrors carrier_interactions so the two logs behave alike,
-- but with its own vocabulary: a customer "sent a quote request", a carrier
-- "asked for quick pay".
create table if not exists public.customer_interaction_types (
  id         uuid primary key default gen_random_uuid(),
  key        text not null unique,
  label      text not null,
  sort_order int not null default 0,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists customer_interaction_types_set_updated_at on public.customer_interaction_types;
create trigger customer_interaction_types_set_updated_at
  before update on public.customer_interaction_types
  for each row execute function public.set_updated_at();

insert into public.customer_interaction_types (key, label, sort_order) values
  ('note',          'Note',           10),
  ('call',          'Phone call',     20),
  ('email',         'Email',          30),
  ('meeting',       'Meeting',        40),
  ('quote_sent',    'Quote sent',     50),
  ('rate_change',   'Rate change',    60),
  ('complaint',     'Complaint',      70),
  ('compliment',    'Compliment',     80),
  ('new_lane',      'New lane',       90),
  ('other',         'Other',         100)
on conflict (key) do update
  set label = excluded.label, sort_order = excluded.sort_order;

create table if not exists public.customer_interactions (
  id                  uuid primary key default gen_random_uuid(),
  customer_id         uuid not null references public.customers(id) on delete cascade,
  load_id             uuid references public.loads(id) on delete set null,
  interaction_type_id uuid not null references public.customer_interaction_types(id) on delete restrict,
  body                text not null,
  -- A date the rep wants to be reminded to follow up. Surfaced on the
  -- customer list when it is due.
  follow_up_at        timestamptz,
  created_by          uuid references public.profiles(id) on delete set null
                        default public.current_profile_id(),
  created_at          timestamptz not null default now()
);

create index if not exists customer_interactions_customer_idx
  on public.customer_interactions (customer_id, created_at desc);
create index if not exists customer_interactions_followup_idx
  on public.customer_interactions (follow_up_at) where follow_up_at is not null;

-- Keep last_activity_at honest from both directions.
create or replace function public.tg_customer_interaction_touch()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.customers
     set last_activity_at = greatest(coalesce(last_activity_at, new.created_at), new.created_at)
   where id = new.customer_id;
  return null;
end;
$$;

drop trigger if exists customer_interactions_touch on public.customer_interactions;
create trigger customer_interactions_touch
  after insert on public.customer_interactions
  for each row execute function public.tg_customer_interaction_touch();

create or replace function public.tg_loads_touch_customer()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.customer_id is not null
     and (tg_op = 'INSERT' or new.customer_id is distinct from old.customer_id)
  then
    update public.customers
       set last_activity_at = greatest(coalesce(last_activity_at, now()), now())
     where id = new.customer_id;
  end if;
  return null;
end;
$$;

drop trigger if exists loads_touch_customer on public.loads;
create trigger loads_touch_customer
  after insert or update of customer_id on public.loads
  for each row execute function public.tg_loads_touch_customer();

-- Customer activity view, same shape as the carrier one.
create or replace view public.v_customer_interactions
with (security_invoker = true) as
select
  ci.id,
  ci.customer_id,
  ci.load_id,
  l.load_number,
  ci.interaction_type_id,
  it.key      as interaction_type_key,
  it.label    as interaction_type_label,
  ci.body,
  ci.follow_up_at,
  ci.created_by,
  p.full_name as created_by_name,
  ci.created_at
from public.customer_interactions ci
left join public.customer_interaction_types it on it.id = ci.interaction_type_id
left join public.loads l    on l.id = ci.load_id
left join public.profiles p on p.id = ci.created_by;

-- ---------------------------------------------------------------------
-- 6. RLS for the new tables
-- ---------------------------------------------------------------------
alter table public.customer_interaction_types enable row level security;
alter table public.customer_interactions      enable row level security;

do $$
begin
  -- Lookup pattern: members read, admins write.
  if not exists (select 1 from pg_policies where policyname = 'customer_interaction_types_select') then
    create policy customer_interaction_types_select on public.customer_interaction_types
      for select to authenticated using (public.is_active_member());
    create policy customer_interaction_types_insert_admin on public.customer_interaction_types
      for insert to authenticated with check (public.is_admin());
    create policy customer_interaction_types_update_admin on public.customer_interaction_types
      for update to authenticated using (public.is_admin()) with check (public.is_admin());
    create policy customer_interaction_types_delete_admin on public.customer_interaction_types
      for delete to authenticated using (public.is_admin());
  end if;

  -- Append-only pattern: members read + insert, admins correct.
  if not exists (select 1 from pg_policies where policyname = 'customer_interactions_select') then
    create policy customer_interactions_select on public.customer_interactions
      for select to authenticated using (public.is_active_member());
    create policy customer_interactions_insert on public.customer_interactions
      for insert to authenticated
      with check (public.current_profile_role() in ('admin', 'dispatcher'));
    create policy customer_interactions_update_admin on public.customer_interactions
      for update to authenticated using (public.is_admin()) with check (public.is_admin());
    create policy customer_interactions_delete_admin on public.customer_interactions
      for delete to authenticated using (public.is_admin());
  end if;
end
$$;

grant select on public.v_customer_interactions to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 7. Bulk import - server-enforced, so the permission is a wall not a hint
-- ---------------------------------------------------------------------
-- The UI hides the button; this is what stops a curl. Both take a JSON
-- array of row objects using the same column names as the CSV template,
-- upsert on the natural key, and report what happened.
create or replace function public.import_carriers(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r          jsonb;
  v_dot      text;
  v_status   text;
  v_equip    text[];
  v_inserted int := 0;
  v_updated  int := 0;
  v_skipped  int := 0;
  v_errors   jsonb := '[]'::jsonb;
  v_idx      int := 0;
  v_existing uuid;
begin
  if not public.has_permission('import_carriers') then
    raise exception 'permission denied: import_carriers' using errcode = '42501';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'import_carriers: expected a JSON array';
  end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    v_idx := v_idx + 1;
    v_dot := nullif(regexp_replace(coalesce(r ->> 'dot_number', ''), '[^0-9]', '', 'g'), '');

    if nullif(btrim(coalesce(r ->> 'name', '')), '') is null then
      v_errors := v_errors || jsonb_build_object('row', v_idx, 'error', 'name is required');
      v_skipped := v_skipped + 1;
      continue;
    end if;

    v_status := lower(coalesce(nullif(btrim(r ->> 'status'), ''), 'active'));
    v_status := replace(v_status, ' ', '_');
    if v_status not in ('active', 'inactive', 'do_not_use') then
      v_errors := v_errors || jsonb_build_object('row', v_idx,
        'error', format('status "%s" must be active, inactive or do_not_use', r ->> 'status'));
      v_skipped := v_skipped + 1;
      continue;
    end if;

    -- "Van; Reefer" or "Van, Reefer" -> {van, reefer}
    v_equip := array_remove(array(
      select lower(btrim(x))
        from regexp_split_to_table(coalesce(r ->> 'equipment_types', ''), '[;,|]') x
       where btrim(x) <> ''
    ), null);

    v_existing := null;
    if v_dot is not null then
      select id into v_existing from public.carriers where dot_number = v_dot;
    end if;

    if v_existing is not null then
      update public.carriers set
        name                   = coalesce(nullif(btrim(r ->> 'name'), ''), name),
        mc_number              = coalesce(nullif(btrim(r ->> 'mc_number'), ''), mc_number),
        scac                   = coalesce(nullif(btrim(r ->> 'scac'), ''), scac),
        address1               = coalesce(nullif(btrim(r ->> 'address1'), ''), address1),
        address2               = coalesce(nullif(btrim(r ->> 'address2'), ''), address2),
        city                   = coalesce(nullif(btrim(r ->> 'city'), ''), city),
        state                  = coalesce(upper(nullif(btrim(r ->> 'state'), '')), state),
        postal                 = coalesce(nullif(btrim(r ->> 'postal'), ''), postal),
        dispatch_contact_name  = coalesce(nullif(btrim(r ->> 'dispatch_contact_name'), ''), dispatch_contact_name),
        dispatch_contact_phone = coalesce(nullif(btrim(r ->> 'dispatch_contact_phone'), ''), dispatch_contact_phone),
        dispatch_contact_email = coalesce(nullif(btrim(r ->> 'dispatch_contact_email'), ''), dispatch_contact_email),
        equipment_types        = case when cardinality(v_equip) > 0 then v_equip else equipment_types end,
        status                 = v_status,
        notes                  = coalesce(nullif(btrim(r ->> 'notes'), ''), notes)
      where id = v_existing;
      v_updated := v_updated + 1;
    else
      insert into public.carriers (
        name, dot_number, mc_number, scac, address1, address2, city, state, postal,
        dispatch_contact_name, dispatch_contact_phone, dispatch_contact_email,
        equipment_types, status, notes, country
      ) values (
        btrim(r ->> 'name'), v_dot,
        nullif(btrim(r ->> 'mc_number'), ''), nullif(btrim(r ->> 'scac'), ''),
        nullif(btrim(r ->> 'address1'), ''), nullif(btrim(r ->> 'address2'), ''),
        nullif(btrim(r ->> 'city'), ''), upper(nullif(btrim(r ->> 'state'), '')),
        nullif(btrim(r ->> 'postal'), ''),
        nullif(btrim(r ->> 'dispatch_contact_name'), ''),
        nullif(btrim(r ->> 'dispatch_contact_phone'), ''),
        nullif(btrim(r ->> 'dispatch_contact_email'), ''),
        v_equip, v_status, nullif(btrim(r ->> 'notes'), ''), 'US'
      );
      v_inserted := v_inserted + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'inserted', v_inserted, 'updated', v_updated, 'skipped', v_skipped, 'errors', v_errors);
end;
$$;

comment on function public.import_carriers(jsonb) is
  'Bulk upsert carriers from the CSV template. Matches on DOT number.
   Requires the import_carriers permission - enforced here, not in the UI.';

create or replace function public.import_customers(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r          jsonb;
  v_name     text;
  v_mc       text;
  v_inserted int := 0;
  v_updated  int := 0;
  v_skipped  int := 0;
  v_errors   jsonb := '[]'::jsonb;
  v_idx      int := 0;
  v_existing uuid;
begin
  if not public.has_permission('import_customers') then
    raise exception 'permission denied: import_customers' using errcode = '42501';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'import_customers: expected a JSON array';
  end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    v_idx := v_idx + 1;
    v_name := nullif(btrim(coalesce(r ->> 'name', '')), '');
    v_mc   := nullif(regexp_replace(coalesce(r ->> 'mc_number', ''), '[^0-9]', '', 'g'), '');

    if v_name is null then
      v_errors := v_errors || jsonb_build_object('row', v_idx, 'error', 'name is required');
      v_skipped := v_skipped + 1;
      continue;
    end if;

    -- Customers have no guaranteed unique id, so the match is MC number
    -- first, then an exact case-insensitive name.
    v_existing := null;
    if v_mc is not null then
      select id into v_existing from public.customers where mc_number = v_mc limit 1;
    end if;
    if v_existing is null then
      select id into v_existing from public.customers where lower(name) = lower(v_name) limit 1;
    end if;

    if v_existing is not null then
      update public.customers set
        mc_number          = coalesce(v_mc, mc_number),
        address1           = coalesce(nullif(btrim(r ->> 'address1'), ''), address1),
        address2           = coalesce(nullif(btrim(r ->> 'address2'), ''), address2),
        city               = coalesce(nullif(btrim(r ->> 'city'), ''), city),
        state              = coalesce(upper(nullif(btrim(r ->> 'state'), '')), state),
        postal             = coalesce(nullif(btrim(r ->> 'postal'), ''), postal),
        main_contact_name  = coalesce(nullif(btrim(r ->> 'main_contact_name'), ''), main_contact_name),
        main_contact_phone = coalesce(nullif(btrim(r ->> 'main_contact_phone'), ''), main_contact_phone),
        main_contact_email = coalesce(nullif(btrim(r ->> 'main_contact_email'), ''), main_contact_email),
        website            = coalesce(nullif(btrim(r ->> 'website'), ''), website),
        industry           = coalesce(nullif(btrim(r ->> 'industry'), ''), industry),
        linkedin_url       = coalesce(nullif(btrim(r ->> 'linkedin_url'), ''), linkedin_url),
        notes              = coalesce(nullif(btrim(r ->> 'notes'), ''), notes),
        active             = coalesce((nullif(lower(btrim(r ->> 'active')), '') in ('true','yes','y','1')), active)
      where id = v_existing;
      v_updated := v_updated + 1;
    else
      insert into public.customers (
        name, mc_number, address1, address2, city, state, postal,
        main_contact_name, main_contact_phone, main_contact_email,
        website, industry, linkedin_url, notes, active, country
      ) values (
        v_name, v_mc,
        nullif(btrim(r ->> 'address1'), ''), nullif(btrim(r ->> 'address2'), ''),
        nullif(btrim(r ->> 'city'), ''), upper(nullif(btrim(r ->> 'state'), '')),
        nullif(btrim(r ->> 'postal'), ''),
        nullif(btrim(r ->> 'main_contact_name'), ''),
        nullif(btrim(r ->> 'main_contact_phone'), ''),
        nullif(btrim(r ->> 'main_contact_email'), ''),
        nullif(btrim(r ->> 'website'), ''), nullif(btrim(r ->> 'industry'), ''),
        nullif(btrim(r ->> 'linkedin_url'), ''), nullif(btrim(r ->> 'notes'), ''),
        coalesce((nullif(lower(btrim(r ->> 'active')), '') in ('true','yes','y','1')), true),
        'US'
      );
      v_inserted := v_inserted + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'inserted', v_inserted, 'updated', v_updated, 'skipped', v_skipped, 'errors', v_errors);
end;
$$;

comment on function public.import_customers(jsonb) is
  'Bulk upsert customers from the CSV template. Matches on MC number, then
   exact name. Requires the import_customers permission - enforced here.';

grant execute on function public.import_carriers(jsonb)  to authenticated;
grant execute on function public.import_customers(jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 8. Reports - one flat row per load with everything the charts need
-- ---------------------------------------------------------------------
-- Test loads are excluded here, once, so no chart can forget to.
create or replace view public.v_report_loads
with (security_invoker = true) as
select
  l.id,
  l.load_number,
  l.created_at,
  l.first_pickup_at,
  l.last_delivery_at,
  l.delivered_at,
  l.invoiced_at,
  l.paid_at,
  l.cancelled_at,
  ps.key         as stage_key,
  ps.label       as stage_label,
  ps.is_booked   as stage_is_booked,
  ps.is_terminal as stage_is_terminal,
  l.customer_id,
  cu.name        as customer_name,
  l.carrier_id,
  ca.name        as carrier_name,
  l.customer_rate,
  l.carrier_rate,
  l.margin,
  case when l.customer_rate is null or l.customer_rate = 0 then null
       else round(l.margin / l.customer_rate, 4) end as margin_pct,
  l.distance_miles,
  case when l.customer_rate is null or l.distance_miles is null or l.distance_miles <= 0 then null
       else round(l.customer_rate / l.distance_miles, 4) end as revenue_per_mile,
  l.origin_city, l.origin_state, om.name as origin_metro_name,
  l.dest_city,   l.dest_state,   dm.name as dest_metro_name,
  l.equipment_type_text,
  l.source
from public.loads l
join public.pipeline_stages ps on ps.id = l.pipeline_stage_id
left join public.customers cu on cu.id = l.customer_id
left join public.carriers  ca on ca.id = l.carrier_id
left join public.metros    om on om.id = l.origin_metro_id
left join public.metros    dm on dm.id = l.dest_metro_id
where not l.is_test;

comment on view public.v_report_loads is
  'Flat per-load facts for the reports page. Excludes test loads.';

grant select on public.v_report_loads to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 9. Manual load creation helper
-- ---------------------------------------------------------------------
-- The app can insert into loads/load_stops directly under RLS, but the
-- stops need metro + timezone resolution and the whole thing should be one
-- transaction. This does both. `p_stops` is an array of
--   {stop_type, name, address1, city, state, postal, contact_name, phone,
--    appointment_local, earliest_local, latest_local, instructions}
-- where *_local are wall-clock 'YYYY-MM-DDTHH:MM' strings read in the
-- stop's own zone.
create or replace function public.create_manual_load(p_load jsonb, p_stops jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_stage_id uuid;
  v_load_id  uuid;
  v_load_no  text;
  s          jsonb;
  v_seq      int := 0;
  v_metro    uuid;
  v_tz       text;
  v_type     text;
begin
  if not public.has_permission('create_loads') then
    raise exception 'permission denied: create_loads' using errcode = '42501';
  end if;

  -- A manual load starts at 'available' (it was typed by a human, so QC is
  -- moot) unless the caller asks for a stage explicitly.
  select id into v_stage_id
    from public.pipeline_stages
   where key = coalesce(nullif(p_load ->> 'stage_key', ''), 'available')
   limit 1;
  if v_stage_id is null then
    raise exception 'create_manual_load: unknown stage %', p_load ->> 'stage_key';
  end if;

  insert into public.loads (
    pipeline_stage_id, source, is_test,
    customer_id, carrier_id,
    shipment_id, equipment_type_text, equipment_length_ft,
    temp_min, temp_max, commodity, total_weight, weight_uom,
    total_quantity, distance_miles, hazmat, notes,
    customer_rate, carrier_rate, currency, driver_name, driver_phone,
    created_by
  ) values (
    v_stage_id, 'manual', coalesce((p_load ->> 'is_test')::boolean, false),
    nullif(p_load ->> 'customer_id', '')::uuid,
    nullif(p_load ->> 'carrier_id', '')::uuid,
    nullif(btrim(p_load ->> 'shipment_id'), ''),
    nullif(btrim(p_load ->> 'equipment_type_text'), ''),
    nullif(p_load ->> 'equipment_length_ft', '')::numeric,
    nullif(p_load ->> 'temp_min', '')::numeric,
    nullif(p_load ->> 'temp_max', '')::numeric,
    nullif(btrim(p_load ->> 'commodity'), ''),
    nullif(p_load ->> 'total_weight', '')::numeric,
    coalesce(nullif(btrim(p_load ->> 'weight_uom'), ''), 'L'),
    nullif(p_load ->> 'total_quantity', '')::numeric,
    nullif(p_load ->> 'distance_miles', '')::numeric,
    coalesce((p_load ->> 'hazmat')::boolean, false),
    nullif(btrim(p_load ->> 'notes'), ''),
    nullif(p_load ->> 'customer_rate', '')::numeric,
    nullif(p_load ->> 'carrier_rate', '')::numeric,
    coalesce(nullif(btrim(p_load ->> 'currency'), ''), 'USD'),
    nullif(btrim(p_load ->> 'driver_name'), ''),
    nullif(btrim(p_load ->> 'driver_phone'), ''),
    public.current_profile_id()
  )
  returning id, load_number into v_load_id, v_load_no;

  for s in select * from jsonb_array_elements(coalesce(p_stops, '[]'::jsonb)) loop
    v_seq := v_seq + 1;
    v_type := coalesce(nullif(s ->> 'stop_type', ''), 'other');
    if v_type not in ('pickup', 'delivery', 'other') then v_type := 'other'; end if;

    v_metro := public.resolve_metro(s ->> 'city', s ->> 'state', s ->> 'postal');
    v_tz    := public.stop_timezone(v_metro);

    insert into public.load_stops (
      load_id, sequence, stop_type, name, address1, address2, city, state, postal, country,
      contact_name, phone, email, metro_id, timezone,
      appointment, earliest, latest, appointment_number, weight, quantity, instructions
    ) values (
      v_load_id, v_seq, v_type,
      nullif(btrim(s ->> 'name'), ''), nullif(btrim(s ->> 'address1'), ''),
      nullif(btrim(s ->> 'address2'), ''), nullif(btrim(s ->> 'city'), ''),
      upper(nullif(btrim(s ->> 'state'), '')), nullif(btrim(s ->> 'postal'), ''), 'US',
      nullif(btrim(s ->> 'contact_name'), ''), nullif(btrim(s ->> 'phone'), ''),
      nullif(btrim(s ->> 'email'), ''), v_metro, v_tz,
      -- Wall-clock in the stop's zone -> timestamptz. `at time zone` on a
      -- naive timestamp does exactly that interpretation.
      case when nullif(s ->> 'appointment_local', '') is null then null
           else (s ->> 'appointment_local')::timestamp at time zone v_tz end,
      case when nullif(s ->> 'earliest_local', '') is null then null
           else (s ->> 'earliest_local')::timestamp at time zone v_tz end,
      case when nullif(s ->> 'latest_local', '') is null then null
           else (s ->> 'latest_local')::timestamp at time zone v_tz end,
      nullif(btrim(s ->> 'appointment_number'), ''),
      nullif(s ->> 'weight', '')::numeric,
      nullif(s ->> 'quantity', '')::numeric,
      nullif(btrim(s ->> 'instructions'), '')
    );
  end loop;

  return jsonb_build_object('load_id', v_load_id, 'load_number', v_load_no);
end;
$$;

comment on function public.create_manual_load(jsonb, jsonb) is
  'Creates a load and its stops in one transaction, resolving each stop''s
   metro and reading its wall-clock times in that metro''s zone. Requires the
   create_loads permission.';

grant execute on function public.create_manual_load(jsonb, jsonb) to authenticated;

-- Stops need to be addable/removable from the load screen now that loads
-- can be built by hand. The rollup trigger already handles insert/delete.
create or replace function public.add_load_stop(p_load_id uuid, p_stop jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_seq   int;
  v_metro uuid;
  v_tz    text;
  v_id    uuid;
  v_type  text;
begin
  if not public.has_permission('edit_loads') then
    raise exception 'permission denied: edit_loads' using errcode = '42501';
  end if;
  if not exists (select 1 from public.loads where id = p_load_id) then
    raise exception 'add_load_stop: load % not found', p_load_id;
  end if;

  select coalesce(max(sequence), 0) + 1 into v_seq from public.load_stops where load_id = p_load_id;
  v_type := coalesce(nullif(p_stop ->> 'stop_type', ''), 'other');
  if v_type not in ('pickup', 'delivery', 'other') then v_type := 'other'; end if;
  v_metro := public.resolve_metro(p_stop ->> 'city', p_stop ->> 'state', p_stop ->> 'postal');
  v_tz    := public.stop_timezone(v_metro);

  insert into public.load_stops (
    load_id, sequence, stop_type, name, address1, city, state, postal, country,
    contact_name, phone, metro_id, timezone, appointment, earliest, latest, instructions
  ) values (
    p_load_id, v_seq, v_type,
    nullif(btrim(p_stop ->> 'name'), ''), nullif(btrim(p_stop ->> 'address1'), ''),
    nullif(btrim(p_stop ->> 'city'), ''), upper(nullif(btrim(p_stop ->> 'state'), '')),
    nullif(btrim(p_stop ->> 'postal'), ''), 'US',
    nullif(btrim(p_stop ->> 'contact_name'), ''), nullif(btrim(p_stop ->> 'phone'), ''),
    v_metro, v_tz,
    case when nullif(p_stop ->> 'appointment_local', '') is null then null
         else (p_stop ->> 'appointment_local')::timestamp at time zone v_tz end,
    case when nullif(p_stop ->> 'earliest_local', '') is null then null
         else (p_stop ->> 'earliest_local')::timestamp at time zone v_tz end,
    case when nullif(p_stop ->> 'latest_local', '') is null then null
         else (p_stop ->> 'latest_local')::timestamp at time zone v_tz end,
    nullif(btrim(p_stop ->> 'instructions'), '')
  )
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.add_load_stop(uuid, jsonb) to authenticated;

-- Edit a stop by hand. Same input shape as add_load_stop. If the location
-- changed, the metro and zone are re-resolved and the times read in the NEW
-- zone - moving a pickup from Atlanta to Dallas and typing "08:00" means
-- 08:00 in Dallas. If the location is the same, times are read in the zone
-- the stop already recorded, which is the zone the screen displayed them in.
create or replace function public.update_load_stop(p_stop_id uuid, p_stop jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old    public.load_stops%rowtype;
  v_metro  uuid;
  v_tz     text;
  v_type   text;
  v_moved  boolean;
begin
  if not public.has_permission('edit_loads') then
    raise exception 'permission denied: edit_loads' using errcode = '42501';
  end if;

  select * into v_old from public.load_stops where id = p_stop_id;
  if v_old.id is null then
    raise exception 'update_load_stop: stop % not found', p_stop_id;
  end if;

  v_moved := (nullif(btrim(p_stop ->> 'city'), '')            is distinct from v_old.city)
          or (upper(nullif(btrim(p_stop ->> 'state'), ''))    is distinct from v_old.state)
          or (nullif(btrim(p_stop ->> 'postal'), '')          is distinct from v_old.postal);

  if v_moved then
    v_metro := public.resolve_metro(p_stop ->> 'city', p_stop ->> 'state', p_stop ->> 'postal');
    v_tz    := public.stop_timezone(v_metro);
  else
    v_metro := v_old.metro_id;
    v_tz    := coalesce(v_old.timezone, public.stop_timezone(v_old.metro_id));
  end if;

  v_type := coalesce(nullif(p_stop ->> 'stop_type', ''), v_old.stop_type);
  if v_type not in ('pickup', 'delivery', 'other') then v_type := 'other'; end if;

  update public.load_stops set
    stop_type          = v_type,
    name               = nullif(btrim(p_stop ->> 'name'), ''),
    address1           = nullif(btrim(p_stop ->> 'address1'), ''),
    address2           = nullif(btrim(p_stop ->> 'address2'), ''),
    city               = nullif(btrim(p_stop ->> 'city'), ''),
    state              = upper(nullif(btrim(p_stop ->> 'state'), '')),
    postal             = nullif(btrim(p_stop ->> 'postal'), ''),
    contact_name       = nullif(btrim(p_stop ->> 'contact_name'), ''),
    phone              = nullif(btrim(p_stop ->> 'phone'), ''),
    email              = nullif(btrim(p_stop ->> 'email'), ''),
    metro_id           = v_metro,
    timezone           = v_tz,
    appointment        = case when nullif(p_stop ->> 'appointment_local', '') is null then null
                              else (p_stop ->> 'appointment_local')::timestamp at time zone v_tz end,
    earliest           = case when nullif(p_stop ->> 'earliest_local', '') is null then null
                              else (p_stop ->> 'earliest_local')::timestamp at time zone v_tz end,
    latest             = case when nullif(p_stop ->> 'latest_local', '') is null then null
                              else (p_stop ->> 'latest_local')::timestamp at time zone v_tz end,
    appointment_number = nullif(btrim(p_stop ->> 'appointment_number'), ''),
    weight             = nullif(p_stop ->> 'weight', '')::numeric,
    quantity           = nullif(p_stop ->> 'quantity', '')::numeric,
    instructions       = nullif(btrim(p_stop ->> 'instructions'), '')
  where id = p_stop_id;

  -- A stop edit is a touch on the load.
  update public.loads set last_touched_at = now() where id = v_old.load_id;
end;
$$;

grant execute on function public.update_load_stop(uuid, jsonb) to authenticated;

-- Re-resolve a stop's metro/zone after its city/state/zip is edited by hand.
-- Without this an edited stop keeps the metro of whatever the tender said.
create or replace function public.tg_load_stops_reresolve_metro()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE'
     and (new.city is distinct from old.city
          or new.state is distinct from old.state
          or new.postal is distinct from old.postal)
  then
    new.metro_id := public.resolve_metro(new.city, new.state, new.postal);
    -- Only replace the zone if the metro moved; a stop that already recorded
    -- the zone its times were read in must keep it.
    if new.metro_id is distinct from old.metro_id then
      new.timezone := public.stop_timezone(new.metro_id);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists load_stops_reresolve_metro on public.load_stops;
create trigger load_stops_reresolve_metro
  before update of city, state, postal on public.load_stops
  for each row execute function public.tg_load_stops_reresolve_metro();

-- Deleting a stop is a load edit, not a hard delete of history: let writers
-- do it. Every other table keeps admin-only delete.
drop policy if exists load_stops_delete_admin on public.load_stops;
drop policy if exists load_stops_delete on public.load_stops;
create policy load_stops_delete on public.load_stops
  for delete to authenticated
  using (public.current_profile_role() in ('admin', 'dispatcher'));

-- Test loads may be deleted by whoever made them. Real loads stay admin-only.
drop policy if exists loads_delete_test_own on public.loads;
create policy loads_delete_test_own on public.loads
  for delete to authenticated
  using (is_test and created_by = auth.uid());
