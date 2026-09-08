-- =====================================================================
-- Solvix Tender Desk - initial schema
-- =====================================================================
-- Phase 1 freight-broker TMS. The `loads` table plus its children mirror
-- the canonical LoadTender JSON shape in src/types/tender.ts; the ingest
-- Edge Function flattens that JSON into these columns and keeps the whole
-- document in `loads.raw_extraction` so nothing is ever lost.
--
-- Conventions
--   * snake_case everywhere
--   * uuid primary keys, default gen_random_uuid()
--   * created_at / updated_at timestamptz on mutable tables, maintained by
--     the shared public.set_updated_at() trigger
--   * child rows of a load cascade on delete; lookup references restrict
--
-- RLS is enabled in 20260101000001_rls_policies.sql, lookups are seeded in
-- 20260101000002_seed_lookups.sql, and the business triggers/views live in
-- 20260101000003_functions_triggers.sql.
-- =====================================================================

create schema if not exists extensions;

-- gen_random_uuid() is built into Postgres 13+. pg_trgm backs the ILIKE
-- "search as you type" indexes on carrier / customer / load numbers.
create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------------
-- Shared updated_at trigger
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function public.set_updated_at() is
  'Shared BEFORE UPDATE trigger: stamps updated_at = now().';

-- =====================================================================
-- profiles - one row per auth.users row
-- =====================================================================
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text,
  email       text,
  role        text not null default 'dispatcher'
                check (role in ('admin', 'dispatcher', 'viewer')),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.profiles is
  'Application identity for an auth.users row. Signup is admin-invite-only.';

create index profiles_active_idx     on public.profiles (active) where active;
create index profiles_role_idx       on public.profiles (role);
create index profiles_email_lower_idx on public.profiles (lower(email));
create index profiles_name_lower_idx  on public.profiles (lower(full_name));

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Identity helpers.
--
-- These are SECURITY DEFINER on purpose. Every RLS policy below calls
-- is_active_member() / is_admin(), including the policies ON profiles
-- itself; without SECURITY DEFINER those would recurse forever. Because
-- the functions are owned by the table owner and `profiles` is NOT set to
-- FORCE ROW LEVEL SECURITY, the lookup inside them bypasses RLS.
-- Do not add `alter table public.profiles force row level security`.
-- ---------------------------------------------------------------------
create or replace function public.current_profile_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.id from public.profiles p where p.id = auth.uid();
$$;

comment on function public.current_profile_id() is
  'auth.uid() when the caller has a profiles row, else NULL. Safe as a
   created_by default: service-role callers (the ingest function) get NULL
   instead of violating the profiles foreign key.';

create or replace function public.is_active_member()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.active
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.active and p.role = 'admin'
  );
$$;

create or replace function public.current_profile_role()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.role from public.profiles p where p.id = auth.uid();
$$;

-- ---------------------------------------------------------------------
-- auth.users -> profiles fan-out
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      nullif(split_part(coalesce(new.email, ''), '@', 1), '')
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

comment on function public.handle_new_user() is
  'Creates the matching profiles row when an invited user is created.
   Role is always the ''dispatcher'' default - never read from user
   metadata, which the invitee could otherwise influence.';

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =====================================================================
-- org_settings - single-row tenant configuration
-- =====================================================================
create table public.org_settings (
  id                int primary key default 1 check (id = 1),
  urgency_rules     jsonb not null default '{}'::jsonb,
  qc_bands          jsonb not null default '{}'::jsonb,
  interaction_aging jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table public.org_settings is
  'Singleton config row (id is pinned to 1). Holds the QC colour bands, the
   load-board urgency thresholds, and the carrier-interaction aging windows.';

create trigger org_settings_set_updated_at
  before update on public.org_settings
  for each row execute function public.set_updated_at();

-- =====================================================================
-- Lookup tables (deliberately tables, not enums, so admins can edit them
-- without a migration and so FKs give us referential integrity)
-- =====================================================================
create table public.pipeline_stages (
  id         uuid primary key default gen_random_uuid(),
  key        text not null unique,
  label      text not null,
  sort_order int not null,
  is_terminal boolean not null default false,
  -- true from the moment a carrier is committed. The load board switches
  -- between the `unbooked` and `booked` urgency rule sets on this flag.
  is_booked  boolean not null default false,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index pipeline_stages_sort_idx on public.pipeline_stages (sort_order);

create trigger pipeline_stages_set_updated_at
  before update on public.pipeline_stages
  for each row execute function public.set_updated_at();

create table public.flag_types (
  id         uuid primary key default gen_random_uuid(),
  key        text not null unique,
  label      text not null,
  sort_order int not null default 0,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.flag_types is 'The "waiting on ..." tags a dispatcher pins to a load.';

create index flag_types_sort_idx on public.flag_types (sort_order);

create trigger flag_types_set_updated_at
  before update on public.flag_types
  for each row execute function public.set_updated_at();

create table public.interaction_types (
  id         uuid primary key default gen_random_uuid(),
  key        text not null unique,
  label      text not null,
  sort_order int not null default 0,
  severity   text not null default 'info'
               check (severity in ('info', 'warn', 'critical')),
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index interaction_types_sort_idx on public.interaction_types (sort_order);

create trigger interaction_types_set_updated_at
  before update on public.interaction_types
  for each row execute function public.set_updated_at();

-- =====================================================================
-- metros + zip crosswalk
-- =====================================================================
create table public.metros (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,      -- 'Atlanta, GA'
  state      text,
  cbsa_code  text,
  center_lat numeric(9,6),
  -- center_lon is not just decoration: the Phase 2 rate-per-mile report
  -- buckets lanes east/west of a longitude cut, so it has to exist now.
  center_lon numeric(9,6),
  aliases    text[] not null default '{}'::text[],
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.metros is
  'Curated freight metros used to group origin/destination cities. `aliases`
   holds the suburb / satellite city names that roll up to the metro.';

create index metros_name_lower_idx on public.metros (lower(name));
create index metros_state_idx      on public.metros (state);
create index metros_aliases_gin    on public.metros using gin (aliases);
create index metros_name_trgm_idx  on public.metros using gin (name extensions.gin_trgm_ops);

create trigger metros_set_updated_at
  before update on public.metros
  for each row execute function public.set_updated_at();

create table public.metro_zip_map (
  id         uuid primary key default gen_random_uuid(),
  zip3       text check (zip3 ~ '^[0-9]{3}$'),
  zip5       text check (zip5 ~ '^[0-9]{5}$'),
  metro_id   uuid not null references public.metros(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint metro_zip_map_needs_a_zip check (zip3 is not null or zip5 is not null)
);

comment on table public.metro_zip_map is
  'ZIP -> metro crosswalk. A zip5 row wins over a zip3 row, which is how a
   handful of genuinely split prefixes (Laredo inside 780, Yuma inside 853)
   are carved out of their neighbours.';

-- One metro per prefix keeps resolution deterministic. See the seed
-- migration for the accuracy caveat.
create unique index metro_zip_map_zip5_key on public.metro_zip_map (zip5)
  where zip5 is not null;
create unique index metro_zip_map_zip3_key on public.metro_zip_map (zip3)
  where zip3 is not null and zip5 is null;
create index metro_zip_map_metro_idx on public.metro_zip_map (metro_id);

create trigger metro_zip_map_set_updated_at
  before update on public.metro_zip_map
  for each row execute function public.set_updated_at();

-- =====================================================================
-- customers
-- =====================================================================
create table public.customers (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  mc_number           text,
  address1            text,
  address2            text,
  city                text,
  state               text,
  postal              text,
  country             text,
  main_contact_name   text,
  main_contact_phone  text,
  main_contact_email  text,
  notes               text,
  active              boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by          uuid references public.profiles(id) on delete set null
                        default public.current_profile_id()
);

-- Name search is the dispatcher's main entry point, so it gets both an
-- exact/prefix btree on lower(name) and a trigram index for infix ILIKE.
create index customers_name_lower_idx on public.customers (lower(name));
create index customers_name_trgm_idx  on public.customers using gin (name extensions.gin_trgm_ops);
create index customers_active_idx     on public.customers (active) where active;
create index customers_mc_number_idx  on public.customers (mc_number) where mc_number is not null;
create index customers_city_state_idx on public.customers (lower(state), lower(city));

create trigger customers_set_updated_at
  before update on public.customers
  for each row execute function public.set_updated_at();

-- =====================================================================
-- carriers
-- =====================================================================
create table public.carriers (
  id                     uuid primary key default gen_random_uuid(),
  name                   text not null,
  -- The primary human lookup key: a dispatcher pastes a DOT number to pull
  -- the carrier. UNIQUE gives us the exact-match index for free.
  dot_number             text unique,
  mc_number              text,
  scac                   text,
  address1               text,
  address2               text,
  city                   text,
  state                  text,
  postal                 text,
  country                text,
  dispatch_contact_name  text,
  dispatch_contact_phone text,
  dispatch_contact_email text,
  equipment_types        text[] not null default '{}'::text[],
  status                 text not null default 'active'
                           check (status in ('active', 'inactive', 'do_not_use')),
  notes                  text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  created_by             uuid references public.profiles(id) on delete set null
                           default public.current_profile_id()
);

-- Partial DOT typing ("2345...") is common, hence the trigram index on top
-- of the unique btree.
create index carriers_dot_number_trgm_idx on public.carriers
  using gin (dot_number extensions.gin_trgm_ops);
create index carriers_mc_number_idx  on public.carriers (mc_number) where mc_number is not null;
create index carriers_scac_idx       on public.carriers (upper(scac)) where scac is not null;
create index carriers_name_lower_idx on public.carriers (lower(name));
create index carriers_name_trgm_idx  on public.carriers using gin (name extensions.gin_trgm_ops);
create index carriers_status_idx     on public.carriers (status);
create index carriers_equipment_gin  on public.carriers using gin (equipment_types);

create trigger carriers_set_updated_at
  before update on public.carriers
  for each row execute function public.set_updated_at();

-- =====================================================================
-- loads - the central wide table
-- =====================================================================
create sequence public.load_number_seq as bigint start with 1 increment by 1;

create table public.loads (
  id                uuid primary key default gen_random_uuid(),

  -- lifecycle ---------------------------------------------------------
  load_number       text not null unique,   -- assigned by trigger when null
  pipeline_stage_id uuid not null references public.pipeline_stages(id) on delete restrict,
  source            text not null default 'manual'
                      check (source in ('manual', 'tender_upload', 'edi_204')),
  source_file_url   text,
  source_file_name  text,
  qc_score          numeric(4,3) check (qc_score is null or (qc_score >= 0 and qc_score <= 1)),
  raw_extraction    jsonb,
  warnings          text[] not null default '{}'::text[],

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid references public.profiles(id) on delete set null
                      default public.current_profile_id(),

  -- per-stage timestamps, stamped by trigger on stage change ----------
  booked_at         timestamptz,
  appt_set_at       timestamptz,
  appt_ready_at     timestamptz,
  in_transit_at     timestamptz,
  delivered_at      timestamptz,
  pod_received_at   timestamptz,
  invoiced_at       timestamptz,
  paid_at           timestamptz,
  cancelled_at      timestamptz,

  -- "nobody has touched this load" signal for the board ---------------
  last_touched_at   timestamptz not null default now(),

  -- parties: both nullable, a human confirms them at QC ---------------
  customer_id       uuid references public.customers(id) on delete restrict,
  carrier_id        uuid references public.carriers(id)  on delete restrict,

  -- flattened tender header fields ------------------------------------
  shipment_id         text,
  purpose             text,
  scac                text,
  method_of_payment   text,
  tender_date         date,
  mc_number           text,
  equipment_type_code text,
  equipment_type_text text,
  equipment_length_ft numeric(6,2),
  equipment_initial   text,
  equipment_number    text,
  temp_min            numeric(6,2),
  temp_max            numeric(6,2),
  total_weight        numeric(12,2),
  weight_uom          text,
  commodity           text,
  distance_miles      numeric(10,2),
  total_quantity      numeric(12,2),
  hazmat              boolean,
  notes               text,
  terms               text,
  driver_name         text,
  driver_phone        text,

  -- money -------------------------------------------------------------
  customer_rate     numeric(12,2),   -- what we bill the customer
  carrier_rate      numeric(12,2),   -- what we pay the carrier
  currency          text not null default 'USD',
  margin            numeric(12,2)
                      generated always as
                        (coalesce(customer_rate, 0) - coalesce(carrier_rate, 0)) stored,

  -- denormalised from load_stops by trigger, so the board is a single
  -- table scan instead of a join + aggregate per row ------------------
  first_pickup_at   timestamptz,
  last_delivery_at  timestamptz,
  origin_city       text,
  origin_state      text,
  origin_metro_id   uuid references public.metros(id) on delete set null,
  dest_city         text,
  dest_state        text,
  dest_metro_id     uuid references public.metros(id) on delete set null
);

comment on table public.loads is
  'One freight load. first_pickup_at / last_delivery_at / origin_* / dest_*
   are maintained by the load_stops rollup trigger - never write them by hand.';
comment on column public.loads.last_touched_at is
  'Bumped by any update to the load, any stop change, and any tracking event.
   Feeds the "stale touch" urgency rule in org_settings.urgency_rules.';

-- The load board's primary query: filter by stage, order by pickup time.
create index loads_stage_pickup_idx    on public.loads (pipeline_stage_id, first_pickup_at);
create index loads_first_pickup_idx    on public.loads (first_pickup_at)
  where first_pickup_at is not null;
create index loads_last_delivery_idx   on public.loads (last_delivery_at)
  where last_delivery_at is not null;
create index loads_last_touched_idx    on public.loads (last_touched_at);
create index loads_created_at_idx      on public.loads (created_at desc);
create index loads_customer_idx        on public.loads (customer_id) where customer_id is not null;
create index loads_carrier_idx         on public.loads (carrier_id)  where carrier_id is not null;
create index loads_origin_metro_idx    on public.loads (origin_metro_id) where origin_metro_id is not null;
create index loads_dest_metro_idx      on public.loads (dest_metro_id)  where dest_metro_id is not null;
create index loads_lane_idx            on public.loads (origin_metro_id, dest_metro_id);
create index loads_qc_score_idx        on public.loads (qc_score) where qc_score is not null;
create index loads_shipment_id_idx     on public.loads (lower(shipment_id)) where shipment_id is not null;
-- Dispatchers type partial load numbers into the omnibox.
create index loads_load_number_trgm_idx on public.loads
  using gin (load_number extensions.gin_trgm_ops);
create index loads_needs_qc_idx        on public.loads (created_at desc)
  where source <> 'manual';

create trigger loads_set_updated_at
  before update on public.loads
  for each row execute function public.set_updated_at();

-- =====================================================================
-- load children
-- =====================================================================
create table public.load_parties (
  id           uuid primary key default gen_random_uuid(),
  load_id      uuid not null references public.loads(id) on delete cascade,
  role         text not null check (role in ('shipper', 'bill_to', 'carrier')),
  name         text,
  address1     text,
  address2     text,
  city         text,
  state        text,
  postal       text,
  country      text,
  code         text,
  contact_name text,
  phone        text,
  email        text,
  fax          text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint load_parties_load_role_key unique (load_id, role)
);

comment on table public.load_parties is
  'Header-level parties exactly as they appeared on the tender. Distinct from
   customers/carriers, which are the confirmed master records.';

create index load_parties_load_idx on public.load_parties (load_id);

create trigger load_parties_set_updated_at
  before update on public.load_parties
  for each row execute function public.set_updated_at();

create table public.load_stops (
  id                 uuid primary key default gen_random_uuid(),
  load_id            uuid not null references public.loads(id) on delete cascade,
  sequence           int,
  stop_type          text not null default 'other'
                       check (stop_type in ('pickup', 'delivery', 'other')),
  reason_code        text,
  -- party columns, inline (same list as load_parties)
  name               text,
  address1           text,
  address2           text,
  city               text,
  state              text,
  postal             text,
  country            text,
  code               text,
  contact_name       text,
  phone              text,
  email              text,
  fax                text,
  metro_id           uuid references public.metros(id) on delete set null,
  earliest           timestamptz,
  latest             timestamptz,
  appointment        timestamptz,
  appointment_number text,
  weight             numeric(12,2),
  weight_uom         text,
  quantity           numeric(12,2),
  instructions       text,
  -- Phase 3 (tracking) writes these; they exist now to avoid a later migration.
  actual_arrival     timestamptz,
  actual_departure   timestamptz,
  raw_extraction     jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index load_stops_load_seq_idx on public.load_stops (load_id, sequence);
create index load_stops_metro_idx    on public.load_stops (metro_id) where metro_id is not null;
create index load_stops_earliest_idx on public.load_stops (earliest) where earliest is not null;
create index load_stops_appt_idx     on public.load_stops (appointment) where appointment is not null;
create index load_stops_city_idx     on public.load_stops (lower(state), lower(city));

create trigger load_stops_set_updated_at
  before update on public.load_stops
  for each row execute function public.set_updated_at();

create table public.load_charges (
  id               uuid primary key default gen_random_uuid(),
  load_id          uuid not null references public.loads(id) on delete cascade,
  description      text,
  accessorial_code text,
  quantity         numeric(12,2),
  rate             numeric(12,2),
  amount           numeric(12,2),
  side             text not null default 'customer'
                     check (side in ('customer', 'carrier')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index load_charges_load_side_idx on public.load_charges (load_id, side);

create trigger load_charges_set_updated_at
  before update on public.load_charges
  for each row execute function public.set_updated_at();

create table public.load_references (
  id         uuid primary key default gen_random_uuid(),
  load_id    uuid not null references public.loads(id) on delete cascade,
  -- NULL stop_id means a header-level reference.
  stop_id    uuid references public.load_stops(id) on delete cascade,
  qualifier  text,
  value      text,
  label      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index load_references_load_idx       on public.load_references (load_id);
create index load_references_stop_idx       on public.load_references (stop_id) where stop_id is not null;
-- "Find the load with PO 44821" is a daily query.
create index load_references_value_lower_idx on public.load_references (lower(value));
create index load_references_value_trgm_idx  on public.load_references
  using gin (value extensions.gin_trgm_ops);
create index load_references_qualifier_idx   on public.load_references (qualifier, lower(value));

create trigger load_references_set_updated_at
  before update on public.load_references
  for each row execute function public.set_updated_at();

create table public.load_status_history (
  id            uuid primary key default gen_random_uuid(),
  load_id       uuid not null references public.loads(id) on delete cascade,
  from_stage_id uuid references public.pipeline_stages(id) on delete restrict,
  to_stage_id   uuid not null references public.pipeline_stages(id) on delete restrict,
  changed_by    uuid references public.profiles(id) on delete set null,
  changed_at    timestamptz not null default now(),
  note          text
);

comment on table public.load_status_history is
  'Append-only stage timeline, written by the loads stage-change trigger.';

create index load_status_history_load_idx on public.load_status_history (load_id, changed_at desc);

create table public.load_field_edits (
  id         uuid primary key default gen_random_uuid(),
  load_id    uuid not null references public.loads(id) on delete cascade,
  field_key  text not null,
  old_value  text,
  new_value  text,
  edited_by  uuid references public.profiles(id) on delete set null,
  edited_at  timestamptz not null default now()
);

comment on table public.load_field_edits is
  'Durable replacement for the legacy in-memory audit trail. Also the training
   corpus for the Phase 2 learning / autocomplete feature, which is why the
   values are stored as text rather than typed per column.';

create index load_field_edits_load_idx  on public.load_field_edits (load_id, edited_at desc);
create index load_field_edits_field_idx on public.load_field_edits (field_key, edited_at desc);
create index load_field_edits_user_idx  on public.load_field_edits (edited_by, edited_at desc);

create table public.load_flags (
  id           uuid primary key default gen_random_uuid(),
  load_id      uuid not null references public.loads(id) on delete cascade,
  flag_type_id uuid not null references public.flag_types(id) on delete restrict,
  note         text,
  created_by   uuid references public.profiles(id) on delete set null
                 default public.current_profile_id(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  resolved_at  timestamptz,
  resolved_by  uuid references public.profiles(id) on delete set null
);

comment on table public.load_flags is
  'Open "waiting on X" tags. Multiple open flags per load are allowed on
   purpose - a load can be waiting on both a rate con and an appointment.';

create index load_flags_open_idx  on public.load_flags (load_id) where resolved_at is null;
create index load_flags_load_idx  on public.load_flags (load_id, created_at desc);
create index load_flags_type_idx  on public.load_flags (flag_type_id) where resolved_at is null;

create trigger load_flags_set_updated_at
  before update on public.load_flags
  for each row execute function public.set_updated_at();

create table public.load_tracking_events (
  id         uuid primary key default gen_random_uuid(),
  load_id    uuid not null references public.loads(id) on delete cascade,
  type       text not null
               check (type in ('check_call', 'tracking_ping', 'dispatcher_note', 'status_update')),
  note       text,
  location   text,
  created_by uuid references public.profiles(id) on delete set null
               default public.current_profile_id(),
  created_at timestamptz not null default now()
);

comment on table public.load_tracking_events is
  'Load-bearing for Phase 1: the booked-load urgency colour turns on whether a
   check call exists for a load whose pickup is imminent.';

create index load_tracking_events_load_idx      on public.load_tracking_events (load_id, created_at desc);
create index load_tracking_events_load_type_idx on public.load_tracking_events (load_id, type, created_at desc);
create index load_tracking_events_check_idx     on public.load_tracking_events (load_id, created_at desc)
  where type = 'check_call';

-- =====================================================================
-- carrier_interactions
-- =====================================================================
create table public.carrier_interactions (
  id                  uuid primary key default gen_random_uuid(),
  carrier_id          uuid not null references public.carriers(id) on delete cascade,
  load_id             uuid references public.loads(id) on delete set null,
  interaction_type_id uuid not null references public.interaction_types(id) on delete restrict,
  body                text not null,
  created_by          uuid references public.profiles(id) on delete set null
                        default public.current_profile_id(),
  created_at          timestamptz not null default now()
);

comment on table public.carrier_interactions is
  'Free-text log of everything a carrier did. The 30-day / 1-year aging query
   in v_carrier_recent_interactions hits this on every carrier pop-up.';

-- The aging query is always (carrier_id, created_at desc) - this index is
-- the whole reason the pop-up is instant.
create index carrier_interactions_carrier_idx on public.carrier_interactions (carrier_id, created_at desc);
create index carrier_interactions_load_idx    on public.carrier_interactions (load_id) where load_id is not null;
create index carrier_interactions_type_idx    on public.carrier_interactions (interaction_type_id, created_at desc);

-- =====================================================================
-- customer_location_history - the QC autocomplete corpus
-- =====================================================================
create table public.customer_location_history (
  id             uuid primary key default gen_random_uuid(),
  customer_id    uuid not null references public.customers(id) on delete cascade,
  role           text not null check (role in ('shipper', 'pickup', 'delivery', 'bill_to')),
  name           text,
  address1       text,
  city           text,
  state          text,
  postal         text,
  metro_id       uuid references public.metros(id) on delete set null,
  use_count      int not null default 1 check (use_count > 0),
  first_seen_at  timestamptz not null default now(),
  last_used_at   timestamptz not null default now(),
  -- lowercased / punctuation-stripped name+address1+city+state+postal
  normalized_key text not null,
  constraint customer_location_history_key
    unique (customer_id, role, normalized_key)
);

comment on table public.customer_location_history is
  'Every location a customer has actually shipped from / to, with a use count.
   Written by upsert_customer_location() when a dispatcher confirms a stop at QC.';

create index customer_location_history_customer_idx on public.customer_location_history (customer_id, role, use_count desc);
create index customer_location_history_recent_idx   on public.customer_location_history (customer_id, last_used_at desc);
create index customer_location_history_metro_idx    on public.customer_location_history (metro_id) where metro_id is not null;
create index customer_location_history_name_trgm    on public.customer_location_history
  using gin (name extensions.gin_trgm_ops);

-- =====================================================================
-- Storage bucket for the uploaded tender documents
-- =====================================================================
-- Private. The ingest Edge Function writes with the service role; the app
-- reads through signed URLs (see the storage.objects policies in the RLS
-- migration). Guarded so the migration is still runnable against a plain
-- Postgres that has no storage schema.
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values (
      'tender-uploads',
      'tender-uploads',
      false,
      26214400,  -- 25 MiB, matches the guard in the ingest function
      array[
        'application/pdf',
        'image/png',
        'image/jpeg',
        'image/tiff',
        'text/plain',
        'application/edi-x12',
        'application/octet-stream'
      ]
    )
    on conflict (id) do nothing;
  end if;
end
$$;
