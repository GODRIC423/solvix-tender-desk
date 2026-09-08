-- =====================================================================
-- Phase 2: carrier performance and metro lane history
-- =====================================================================
-- Turns the raw load history into the two things a dispatcher asks before
-- booking somebody: "are they any good?" and "have they run this lane?".
--
-- Everything here is derived. No new facts are recorded by this migration —
-- it reads loads, stops and interactions that Phase 1 already captures. That
-- means the numbers are only as good as the arrival times people log, which
-- is why the load screen gained arrive/depart buttons alongside this.
-- =====================================================================

-- How late still counts as on time. Brokers genuinely disagree about this,
-- so it is a setting rather than a number buried in a view.
alter table public.org_settings
  add column if not exists on_time_grace_minutes integer not null default 15;

comment on column public.org_settings.on_time_grace_minutes is
  'Minutes past the appointment (or the end of the window) that still counts
   as on time.';

-- How far apart two metros must be, in degrees of longitude, before a lane
-- counts as directional. Without this, Atlanta -> Marietta would be logged as
-- an eastbound haul and drag the average around.
alter table public.org_settings
  add column if not exists direction_min_lon_delta numeric not null default 2.0;

comment on column public.org_settings.direction_min_lon_delta is
  'Minimum longitude difference for a lane to count as east- or westbound.
   Shorter hops are treated as regional and left out of the split.';

-- ---------------------------------------------------------------------
-- v_load_performance - one row per completed load, with the derived facts
-- ---------------------------------------------------------------------
-- Split out from the carrier rollup so the per-load numbers are inspectable:
-- when an on-time percentage looks wrong, this is where you see which load
-- caused it.
create or replace view public.v_load_performance
with (security_invoker = true) as
with cfg as (
  select
    coalesce(on_time_grace_minutes, 15)    as grace_minutes,
    coalesce(direction_min_lon_delta, 2.0) as min_lon_delta
  from public.org_settings where id = 1
),
stop_facts as (
  select
    s.load_id,
    s.stop_type,
    -- The commitment we are judged against: an explicit appointment if there
    -- is one, otherwise the close of the delivery window.
    coalesce(s.appointment, s.latest) as due_at,
    s.actual_arrival
  from public.load_stops s
  where s.stop_type in ('pickup', 'delivery')
),
per_load as (
  select
    l.id                as load_id,
    l.carrier_id,
    l.customer_id,
    l.delivered_at,
    l.carrier_rate,
    l.distance_miles,
    l.origin_metro_id,
    l.dest_metro_id,
    om.center_lon       as origin_lon,
    dm.center_lon       as dest_lon,
    -- On-time is only a question once we know when they actually showed up.
    min(case when sf.stop_type = 'pickup'   then sf.due_at end)         as pickup_due_at,
    min(case when sf.stop_type = 'pickup'   then sf.actual_arrival end) as pickup_arrived_at,
    max(case when sf.stop_type = 'delivery' then sf.due_at end)         as delivery_due_at,
    max(case when sf.stop_type = 'delivery' then sf.actual_arrival end) as delivery_arrived_at
  from public.loads l
  left join stop_facts sf on sf.load_id = l.id
  left join public.metros om on om.id = l.origin_metro_id
  left join public.metros dm on dm.id = l.dest_metro_id
  where l.carrier_id is not null
  group by l.id, l.carrier_id, l.customer_id, l.delivered_at, l.carrier_rate,
           l.distance_miles, l.origin_metro_id, l.dest_metro_id, om.center_lon, dm.center_lon
)
select
  p.load_id,
  p.carrier_id,
  p.customer_id,
  p.delivered_at,
  p.carrier_rate,
  p.distance_miles,
  p.origin_metro_id,
  p.dest_metro_id,
  p.pickup_due_at,
  p.pickup_arrived_at,
  p.delivery_due_at,
  p.delivery_arrived_at,

  case
    when p.pickup_arrived_at is null or p.pickup_due_at is null then null
    else p.pickup_arrived_at <= p.pickup_due_at + make_interval(mins => c.grace_minutes)
  end as pickup_on_time,

  case
    when p.delivery_arrived_at is null or p.delivery_due_at is null then null
    else p.delivery_arrived_at <= p.delivery_due_at + make_interval(mins => c.grace_minutes)
  end as delivery_on_time,

  case
    when p.carrier_rate is null or p.distance_miles is null or p.distance_miles <= 0 then null
    else round(p.carrier_rate / p.distance_miles, 4)
  end as rate_per_mile,

  -- Longitude increases eastward, so a destination further east than the
  -- origin is an eastbound haul.
  case
    when p.origin_lon is null or p.dest_lon is null then null
    when abs(p.dest_lon - p.origin_lon) < c.min_lon_delta then 'regional'
    when p.dest_lon > p.origin_lon then 'eastbound'
    else 'westbound'
  end as direction

from per_load p cross join cfg c;

comment on view public.v_load_performance is
  'Per-load derived performance: on-time flags against appointment plus grace,
   rate per mile, and lane direction. The inspectable layer under
   v_carrier_performance.';

-- ---------------------------------------------------------------------
-- v_carrier_performance - the carrier scorecard
-- ---------------------------------------------------------------------
-- Left-joined from carriers so a brand new carrier appears with nulls rather
-- than vanishing from the list.
create or replace view public.v_carrier_performance
with (security_invoker = true) as
select
  ca.id   as carrier_id,
  ca.name as carrier_name,
  ca.dot_number,
  ca.status,

  count(lp.load_id)                                      as loads_total,
  count(lp.delivered_at)                                 as loads_delivered,
  max(lp.delivered_at)                                   as last_delivered_at,

  -- Percentages are null, not zero, until somebody has actually logged an
  -- arrival. "No data" and "never on time" must not look the same.
  count(*) filter (where lp.pickup_on_time is not null)  as pickup_rated_count,
  case when count(*) filter (where lp.pickup_on_time is not null) = 0 then null
       else round(100.0 * count(*) filter (where lp.pickup_on_time)
                  / count(*) filter (where lp.pickup_on_time is not null), 1)
  end as on_time_pickup_pct,

  count(*) filter (where lp.delivery_on_time is not null) as delivery_rated_count,
  case when count(*) filter (where lp.delivery_on_time is not null) = 0 then null
       else round(100.0 * count(*) filter (where lp.delivery_on_time)
                  / count(*) filter (where lp.delivery_on_time is not null), 1)
  end as on_time_delivery_pct,

  round(avg(lp.rate_per_mile), 4)                        as avg_rate_per_mile,
  round(avg(lp.rate_per_mile) filter (where lp.direction = 'eastbound'), 4)
                                                         as avg_rate_per_mile_eastbound,
  round(avg(lp.rate_per_mile) filter (where lp.direction = 'westbound'), 4)
                                                         as avg_rate_per_mile_westbound,
  count(*) filter (where lp.direction = 'eastbound')      as eastbound_loads,
  count(*) filter (where lp.direction = 'westbound')      as westbound_loads,

  -- The behaviour flags. These are counted from structured interaction types
  -- rather than parsed out of free text, which is why they are trustworthy
  -- enough to show on a scorecard.
  coalesce(ix.quick_pay_requests, 0)                     as quick_pay_requests,
  coalesce(ix.rate_increase_requests, 0)                 as rate_increase_requests,
  coalesce(ix.service_failures, 0)                       as service_failures,
  coalesce(ix.fell_off_loads, 0)                         as fell_off_loads,
  ix.last_interaction_at

from public.carriers ca
left join public.v_load_performance lp on lp.carrier_id = ca.id
left join lateral (
  select
    count(*) filter (where it.key = 'quick_pay_request')     as quick_pay_requests,
    count(*) filter (where it.key = 'rate_increase_request') as rate_increase_requests,
    count(*) filter (where it.key = 'service_failure')       as service_failures,
    count(*) filter (where it.key = 'fell_off_load')         as fell_off_loads,
    max(ci.created_at)                                       as last_interaction_at
  from public.carrier_interactions ci
  join public.interaction_types it on it.id = ci.interaction_type_id
  where ci.carrier_id = ca.id
) ix on true
group by ca.id, ca.name, ca.dot_number, ca.status,
         ix.quick_pay_requests, ix.rate_increase_requests, ix.service_failures,
         ix.fell_off_loads, ix.last_interaction_at;

comment on view public.v_carrier_performance is
  'Carrier scorecard: on-time percentages, rate per mile split east/west, and
   counts of the behaviours worth remembering. Percentages are null until an
   arrival has actually been logged.';

-- ---------------------------------------------------------------------
-- carriers_for_lane - who has run this before
-- ---------------------------------------------------------------------
-- Metro to metro, not zip to zip. A carrier who ran Marietta is a carrier who
-- ran Atlanta, and asking for the exact town is how you end up with three
-- options instead of thirty.
--
-- Ranked by an exact match on the lane first, then by the origin metro alone,
-- so "nobody has run this exact lane" still returns people who know the
-- pickup area.
create or replace function public.carriers_for_lane(
  p_origin_metro uuid,
  p_dest_metro   uuid default null,
  p_limit        integer default 25
)
returns table (
  carrier_id            uuid,
  carrier_name          text,
  dot_number            text,
  status                text,
  lane_loads            bigint,
  origin_metro_loads    bigint,
  avg_rate_per_mile     numeric,
  last_hauled_at        timestamptz,
  on_time_delivery_pct  numeric,
  match_kind            text
)
language sql
stable
set search_path = public, pg_temp
as $$
  with scoped as (
    select
      lp.carrier_id,
      count(*) filter (
        where p_dest_metro is not null and lp.dest_metro_id = p_dest_metro
      ) as lane_loads,
      count(*) as origin_metro_loads,
      avg(lp.rate_per_mile) as avg_rate_per_mile,
      max(coalesce(lp.delivered_at, lp.delivery_due_at, lp.pickup_due_at)) as last_hauled_at
    from public.v_load_performance lp
    where lp.origin_metro_id = p_origin_metro
      and lp.carrier_id is not null
    group by lp.carrier_id
  )
  select
    c.id,
    c.name,
    c.dot_number,
    c.status,
    s.lane_loads,
    s.origin_metro_loads,
    round(s.avg_rate_per_mile, 4),
    s.last_hauled_at,
    perf.on_time_delivery_pct,
    case when s.lane_loads > 0 then 'lane' else 'origin_metro' end as match_kind
  from scoped s
  join public.carriers c on c.id = s.carrier_id
  left join public.v_carrier_performance perf on perf.carrier_id = s.carrier_id
  -- A carrier you have marked do-not-use should never be suggested.
  where c.status <> 'do_not_use'
  order by s.lane_loads desc, s.origin_metro_loads desc, s.last_hauled_at desc nulls last
  limit greatest(p_limit, 1);
$$;

comment on function public.carriers_for_lane(uuid, uuid, integer) is
  'Carriers who have run out of this origin metro, exact-lane matches first.
   Excludes do-not-use carriers.';

grant select on public.v_load_performance    to authenticated, service_role;
grant select on public.v_carrier_performance to authenticated, service_role;
grant execute on function public.carriers_for_lane(uuid, uuid, integer)
  to authenticated, service_role;
