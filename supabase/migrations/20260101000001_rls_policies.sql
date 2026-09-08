-- =====================================================================
-- Solvix Tender Desk - row level security
-- =====================================================================
-- Trust model
--   * Everyone who can reach the API is an invited employee. There is no
--     self-serve signup (see config.toml [auth] enable_signup = false) and
--     no policy anywhere grants `anon` anything.
--   * `is_active_member()` = has a profiles row with active = true. That is
--     the read/write bar for all business data.
--   * `is_admin()` = active + role 'admin'. That is the bar for destructive
--     operations, lookup-table edits, and org_settings.
--   * Writes additionally require role 'admin' or 'dispatcher'. A 'viewer' is
--     genuinely read-only: they pass is_active_member() and can SELECT, but
--     every INSERT/UPDATE policy on business data checks the role.
--   * The ingest Edge Function uses the service role, which bypasses RLS
--     entirely. Its authorization is enforced inside the function.
--
-- Both helper functions are SECURITY DEFINER (defined in the schema
-- migration) so that the policies on `profiles` do not recurse. That only
-- works because `profiles` is not FORCE ROW LEVEL SECURITY - keep it that way.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Enable RLS on every table. No exceptions.
-- ---------------------------------------------------------------------
alter table public.profiles                  enable row level security;
alter table public.org_settings              enable row level security;
alter table public.pipeline_stages           enable row level security;
alter table public.flag_types                enable row level security;
alter table public.interaction_types         enable row level security;
alter table public.metros                    enable row level security;
alter table public.metro_zip_map             enable row level security;
alter table public.customers                 enable row level security;
alter table public.carriers                  enable row level security;
alter table public.loads                     enable row level security;
alter table public.load_parties              enable row level security;
alter table public.load_stops                enable row level security;
alter table public.load_charges              enable row level security;
alter table public.load_references           enable row level security;
alter table public.load_status_history       enable row level security;
alter table public.load_field_edits          enable row level security;
alter table public.load_flags                enable row level security;
alter table public.load_tracking_events      enable row level security;
alter table public.carrier_interactions      enable row level security;
alter table public.customer_location_history enable row level security;

-- =====================================================================
-- profiles
-- =====================================================================
-- Any active member can read every active profile - the UI needs it to render
-- "edited by Dana" on the field-edit trail. A deactivated user can still read
-- their own row so the app can show them a sensible "account disabled" state.
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = auth.uid() or (active and public.is_active_member()));

-- A user may edit their own row (name, etc). Role and active are protected by
-- the guard trigger below, not by this policy - expressing it in the policy
-- would need a self-referencing subquery on `profiles`.
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create policy profiles_update_admin on public.profiles
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Signup is admin-invite-only: there is deliberately NO self-serve INSERT
-- policy. Rows are normally created by the SECURITY DEFINER handle_new_user()
-- trigger on auth.users; this policy only lets an admin pre-create one.
create policy profiles_insert_admin on public.profiles
  for insert to authenticated
  with check (public.is_admin());

create policy profiles_delete_admin on public.profiles
  for delete to authenticated
  using (public.is_admin());

-- Privilege-escalation guard: only an admin may change `role` or `active`.
create or replace function public.tg_profiles_guard_privileged_columns()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if (new.role is distinct from old.role or new.active is distinct from old.active)
     and not public.is_admin()
     and auth.uid() is not null
  then
    raise exception 'only an admin may change profiles.role or profiles.active'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

comment on function public.tg_profiles_guard_privileged_columns() is
  'Blocks self role-escalation. The `auth.uid() is not null` clause lets the
   service role and migrations manage roles out of band; every request that
   arrives with a user JWT is checked.';

create trigger profiles_guard_privileged_columns
  before update on public.profiles
  for each row execute function public.tg_profiles_guard_privileged_columns();

-- =====================================================================
-- org_settings - read by everyone, written by admins
-- =====================================================================
create policy org_settings_select on public.org_settings
  for select to authenticated
  using (public.is_active_member());

create policy org_settings_update_admin on public.org_settings
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- No INSERT/DELETE policy: the singleton row is created by the seed
-- migration and is not meant to be replaced at runtime.

-- =====================================================================
-- Lookup tables - readable by members, editable by admins only
-- =====================================================================
do $$
declare
  t text;
begin
  foreach t in array array[
    'pipeline_stages', 'flag_types', 'interaction_types', 'metros', 'metro_zip_map'
  ]
  loop
    execute format(
      'create policy %1$I on public.%2$I for select to authenticated
         using (public.is_active_member())', t || '_select', t);
    execute format(
      'create policy %1$I on public.%2$I for insert to authenticated
         with check (public.is_admin())', t || '_insert_admin', t);
    execute format(
      'create policy %1$I on public.%2$I for update to authenticated
         using (public.is_admin()) with check (public.is_admin())', t || '_update_admin', t);
    execute format(
      'create policy %1$I on public.%2$I for delete to authenticated
         using (public.is_admin())', t || '_delete_admin', t);
  end loop;
end
$$;

-- =====================================================================
-- Business tables
-- =====================================================================
-- Two shapes, because not every table should be editable after the fact.
--
-- MUTABLE tables (current state - a load, a carrier, an open flag):
--   SELECT          : is_active_member()
--   INSERT / UPDATE : admin or dispatcher   <- viewers are read-only
--   DELETE          : is_admin()
--
-- APPEND-ONLY tables (the record of what happened):
--   SELECT / INSERT : as above
--   UPDATE / DELETE : is_admin() only
--
-- The append-only split matters for the product, not just for tidiness. The
-- carrier interaction log is what stops someone re-booking the truck whose
-- turbo blew on Tuesday, and the field-edit trail is the evidence of who
-- changed a rate. If any dispatcher can quietly rewrite those rows, neither
-- is worth much. Admins can still correct a genuine mistake.
--
-- Hard deletes are admin-only across the board. Dispatchers retire a load by
-- moving it to the `cancelled` stage, not by deleting it, so the history
-- survives.
do $$
declare
  t text;
  writer constant text := $w$public.current_profile_role() in ('admin','dispatcher')$w$;
begin
  -- Mutable: current-state tables.
  foreach t in array array[
    'customers',
    'carriers',
    'loads',
    'load_parties',
    'load_stops',
    'load_charges',
    'load_references',
    'load_flags',
    'customer_location_history'
  ]
  loop
    execute format(
      'create policy %1$I on public.%2$I for select to authenticated
         using (public.is_active_member())', t || '_select', t);
    execute format(
      'create policy %1$I on public.%2$I for insert to authenticated
         with check (%3$s)', t || '_insert', t, writer);
    execute format(
      'create policy %1$I on public.%2$I for update to authenticated
         using (%3$s) with check (%3$s)', t || '_update', t, writer);
    execute format(
      'create policy %1$I on public.%2$I for delete to authenticated
         using (public.is_admin())', t || '_delete_admin', t);
  end loop;

  -- Append-only: the audit and activity record.
  foreach t in array array[
    'load_status_history',
    'load_field_edits',
    'load_tracking_events',
    'carrier_interactions'
  ]
  loop
    execute format(
      'create policy %1$I on public.%2$I for select to authenticated
         using (public.is_active_member())', t || '_select', t);
    execute format(
      'create policy %1$I on public.%2$I for insert to authenticated
         with check (%3$s)', t || '_insert', t, writer);
    execute format(
      'create policy %1$I on public.%2$I for update to authenticated
         using (public.is_admin()) with check (public.is_admin())',
      t || '_update_admin', t);
    execute format(
      'create policy %1$I on public.%2$I for delete to authenticated
         using (public.is_admin())', t || '_delete_admin', t);
  end loop;
end
$$;

-- =====================================================================
-- Storage: the private `tender-uploads` bucket
-- =====================================================================
-- Members may read (so the app can mint signed URLs) and upload; only admins
-- may delete or overwrite an object. The ingest function writes with the
-- service role and is not subject to these.
do $$
begin
  if to_regclass('storage.objects') is null then
    return;
  end if;

  execute $p$
    create policy tender_uploads_select on storage.objects
      for select to authenticated
      using (bucket_id = 'tender-uploads' and public.is_active_member())
  $p$;

  execute $p$
    create policy tender_uploads_insert on storage.objects
      for insert to authenticated
      with check (bucket_id = 'tender-uploads' and public.is_active_member())
  $p$;

  execute $p$
    create policy tender_uploads_update_admin on storage.objects
      for update to authenticated
      using (bucket_id = 'tender-uploads' and public.is_admin())
      with check (bucket_id = 'tender-uploads' and public.is_admin())
  $p$;

  execute $p$
    create policy tender_uploads_delete_admin on storage.objects
      for delete to authenticated
      using (bucket_id = 'tender-uploads' and public.is_admin())
  $p$;
exception
  when insufficient_privilege then
    raise notice 'skipping storage.objects policies: insufficient privilege';
  when duplicate_object then
    raise notice 'storage.objects policies already exist';
end
$$;

-- =====================================================================
-- Grants
-- =====================================================================
-- RLS is the actual gate; these grants just make sure the roles can reach
-- the tables at all. `anon` is granted nothing on purpose.
grant usage on schema public to authenticated, service_role;

grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;

-- The load_number trigger calls nextval() as the invoking user.
grant usage, select on all sequences in schema public to authenticated;
grant all on all sequences in schema public to service_role;

alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public
  grant usage, select on sequences to authenticated;

-- =====================================================================
-- REVIEWER NOTES - places this file could over- or under-permit
-- =====================================================================
-- 1. Nothing scopes rows to a tenant or a team - this is a single-brokerage
--    deployment. Adding a second brokerage means adding an org_id column and
--    a membership predicate to every policy here.
-- 2. is_active_member()/is_admin() are SECURITY DEFINER. Do not add
--    `force row level security` to public.profiles or they will recurse.
-- 3. Storage INSERT on tender-uploads is is_active_member(), not the stricter
--    writer role - a viewer could upload an object. Objects are only reachable
--    via a load row they cannot create, so the blast radius is orphaned files;
--    narrow it if that is not acceptable.
-- 4. A dispatcher can still UPDATE `loads.customer_rate` / `carrier_rate`.
--    If rate changes should be admin-only, they need to move out of the
--    blanket loads UPDATE policy into a column-level grant.
-- 5. Deactivating a user (profiles.active = false) revokes access on their
--    next request, but does not invalidate an already-issued JWT. Worst case
--    they keep access until the token expires (1 hour by default).
