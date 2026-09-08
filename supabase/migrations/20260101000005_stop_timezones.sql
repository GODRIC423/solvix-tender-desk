-- =====================================================================
-- Stop timezones
-- =====================================================================
-- A tender says "pickup 08:00 on the 20th". It means 08:00 at the dock, in
-- whatever zone the dock is in. Ingest was reading naive datetimes as UTC, so
-- an 08:00 appointment in Los Angeles was stored as 08:00Z — eight hours early.
--
-- That is not a cosmetic error. `loads.first_pickup_at` is what the load board
-- colours by, so every West Coast load would have shown the wrong urgency, and
-- a load flagged red is a dispatcher's cue to act. Wrong-by-eight-hours is
-- worse than no colour at all.
--
-- The fix: metros carry an IANA timezone, ingest resolves the stop's metro and
-- interprets the wall-clock time in that zone. Where a stop has no metro we
-- fall back to the org's own timezone rather than silently assuming UTC.
-- =====================================================================

alter table public.metros
  add column if not exists timezone text;

comment on column public.metros.timezone is
  'IANA timezone for the metro, used to read a tender''s wall-clock times.
   Metros rarely straddle a zone boundary; where a state does, the exceptions
   below are set per metro.';

-- The common case: one zone per state.
update public.metros set timezone = case state
  when 'AL' then 'America/Chicago'
  when 'AZ' then 'America/Phoenix'      -- no DST, deliberately its own zone
  when 'AR' then 'America/Chicago'
  when 'CA' then 'America/Los_Angeles'
  when 'CO' then 'America/Denver'
  when 'CT' then 'America/New_York'
  when 'DE' then 'America/New_York'
  when 'DC' then 'America/New_York'
  when 'FL' then 'America/New_York'
  when 'GA' then 'America/New_York'
  when 'ID' then 'America/Boise'
  when 'IL' then 'America/Chicago'
  when 'IN' then 'America/Indiana/Indianapolis'
  when 'IA' then 'America/Chicago'
  when 'KS' then 'America/Chicago'
  when 'KY' then 'America/New_York'
  when 'LA' then 'America/Chicago'
  when 'ME' then 'America/New_York'
  when 'MD' then 'America/New_York'
  when 'MA' then 'America/New_York'
  when 'MI' then 'America/Detroit'
  when 'MN' then 'America/Chicago'
  when 'MS' then 'America/Chicago'
  when 'MO' then 'America/Chicago'
  when 'MT' then 'America/Denver'
  when 'NE' then 'America/Chicago'
  when 'NV' then 'America/Los_Angeles'
  when 'NH' then 'America/New_York'
  when 'NJ' then 'America/New_York'
  when 'NM' then 'America/Denver'
  when 'NY' then 'America/New_York'
  when 'NC' then 'America/New_York'
  when 'ND' then 'America/Chicago'
  when 'OH' then 'America/New_York'
  when 'OK' then 'America/Chicago'
  when 'OR' then 'America/Los_Angeles'
  when 'PA' then 'America/New_York'
  when 'RI' then 'America/New_York'
  when 'SC' then 'America/New_York'
  when 'SD' then 'America/Chicago'
  when 'TN' then 'America/Chicago'
  when 'TX' then 'America/Chicago'
  when 'UT' then 'America/Denver'
  when 'VT' then 'America/New_York'
  when 'VA' then 'America/New_York'
  when 'WA' then 'America/Los_Angeles'
  when 'WV' then 'America/New_York'
  when 'WI' then 'America/Chicago'
  when 'WY' then 'America/Denver'
  else 'America/Chicago'
end
where timezone is null;

-- The states that genuinely straddle a boundary, corrected per metro. Each of
-- these is a real freight market on the "wrong" side of its state's zone.
update public.metros set timezone = 'America/Chicago'
  where name in ('Pensacola, FL', 'Evansville, IN');

update public.metros set timezone = 'America/Denver'
  where name in ('Rapid City, SD', 'El Paso, TX', 'Billings, MT');

update public.metros set timezone = 'America/New_York'
  where name in ('Knoxville, TN', 'Chattanooga, TN');

alter table public.metros
  alter column timezone set not null,
  alter column timezone set default 'America/Chicago';

-- Which zone a stop's times were actually read in. Recorded rather than
-- recomputed so a later metro correction cannot silently reinterpret times
-- that were already stored.
alter table public.load_stops
  add column if not exists timezone text;

comment on column public.load_stops.timezone is
  'IANA zone the wall-clock times on this stop were interpreted in. Null means
   the times came in with an explicit offset, or predate this column.';

-- The fallback when a stop has no metro: the brokerage's own zone.
alter table public.org_settings
  add column if not exists default_timezone text not null default 'America/Chicago';

comment on column public.org_settings.default_timezone is
  'Used to read a tender''s wall-clock times when the stop''s metro is unknown.
   Set this to the office''s zone.';

-- ---------------------------------------------------------------------
-- Resolve the zone to read a stop's times in.
-- ---------------------------------------------------------------------
create or replace function public.stop_timezone(p_metro_id uuid)
returns text
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(
    (select m.timezone from public.metros m where m.id = p_metro_id),
    (select o.default_timezone from public.org_settings o where o.id = 1),
    'America/Chicago'
  );
$$;

comment on function public.stop_timezone(uuid) is
  'The IANA zone a stop''s wall-clock times should be read in: the metro''s,
   else the org default.';

grant execute on function public.stop_timezone(uuid) to authenticated, service_role;
