-- =====================================================================
-- Demo dataset for the hosted project
-- =====================================================================
-- Fills an empty desk with something to click: customers that have real,
-- repeated shipping locations, a set of carriers, and ~24 loads spread over
-- the last five weeks across every stage. It exists so the board, the
-- reports page, and — the point of this file — the per-customer location
-- dropdowns have data to show.
--
-- HOW THE LOCATION LEARNING GETS EXERCISED
-- Each load is inserted WITH its customer_id, then its stops. The
-- load_stops learning trigger (migration 4) fires on stop insert, reads the
-- load's customer, and records the stop in customer_location_history with a
-- use count. Because every load for a customer reuses that customer's own
-- pickup facility, the pickup's use_count climbs — which is exactly what
-- makes it the top dropdown pick at QC on the next tender.
--
-- IDEMPOTENT. Safe to run repeatedly:
--   * customers are matched by name, carriers by DOT — never duplicated
--   * loads carry DEMO- shipment ids; this file deletes and recreates them
--
-- TO WIPE the demo loads later (leaves customers/carriers):
--   delete from public.loads where shipment_id like 'DEMO-%';
--
-- Run by the "Seed demo data" workflow, or by hand:
--   psql "<connection>" -v ON_ERROR_STOP=1 -f supabase/seed/demo_data.sql
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Customers (matched by name)
-- ---------------------------------------------------------------------
do $$
declare
  c record;
  v_id uuid;
begin
  for c in
    select * from (values
      ('Acme Foods',             'Food & beverage',   'Marietta', 'GA', '30062', 'Jordan Lee', '(770) 555-0100', 'ops@acmefoods.example',        'https://acmefoods.example'),
      ('Blue Ridge Produce',     'Produce',           'Savannah', 'GA', '31407', 'Dana Cole',  '(912) 555-0110', 'dispatch@blueridge.example',   'https://blueridge.example'),
      ('Lone Star Distribution', 'Distribution',      'Dallas',   'TX', '75247', 'Sam Ortiz',  '(214) 555-0120', 'loads@lonestardist.example',   'https://lonestardist.example'),
      ('Great Lakes Paper',      'Paper & packaging', 'Joliet',   'IL', '60436', 'Pat Nowak',  '(815) 555-0130', 'ship@greatlakespaper.example', 'https://greatlakespaper.example'),
      ('Pacific Coast Imports',  'Import / export',   'Ontario',  'CA', '91761', 'Robin Tran', '(909) 555-0140', 'traffic@pcimports.example',    'https://pcimports.example')
    ) as t(name, industry, city, state, postal, contact, phone, email, website)
  loop
    select id into v_id from public.customers where lower(name) = lower(c.name) limit 1;
    if v_id is null then
      insert into public.customers
        (name, industry, city, state, postal, country,
         main_contact_name, main_contact_phone, main_contact_email, website, active)
      values
        (c.name, c.industry, c.city, c.state, c.postal, 'US',
         c.contact, c.phone, c.email, c.website, true);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 2. Carriers (matched by DOT)
-- ---------------------------------------------------------------------
insert into public.carriers
  (name, dot_number, mc_number, equipment_types, status, city, state,
   dispatch_contact_name, dispatch_contact_phone, country)
values
  ('Fast Freight LLC',  '2345678', '876543', array['van','reefer'],       'active',     'Marietta', 'GA', 'Dana Ruiz',   '(770) 555-0142', 'US'),
  ('Rapid Haul Inc',    '3456789', '765432', array['van'],                'active',     'Dallas',   'TX', 'Chris Vance', '(214) 555-0152', 'US'),
  ('Mountain Movers',   '4567890', '654321', array['flatbed','stepdeck'], 'active',     'Denver',   'CO', 'Lee Park',    '(303) 555-0162', 'US'),
  ('Coastal Carriers',  '5678901', '543210', array['reefer'],             'active',     'Ontario',  'CA', 'Morgan Diaz', '(909) 555-0172', 'US'),
  ('Roadside Retreads', '5550000', null,     array['van'],                'do_not_use', 'Memphis',  'TN', null,          null,             'US')
on conflict (dot_number) do nothing;

-- ---------------------------------------------------------------------
-- 3. Loads + stops
-- ---------------------------------------------------------------------
delete from public.loads where shipment_id like 'DEMO-%';

do $$
declare
  -- one fixed pickup facility per customer (this is what accrues use_count)
  r        record;
  v_stage  uuid;
  v_load   uuid;
  v_cust   uuid;
  v_carr   uuid;
  v_pu_tz  text;
  v_de_tz  text;
  v_pu_metro uuid;
  v_de_metro uuid;
  n_active int;
  n_lanes  int;
  d        int;          -- days offset from today (positive = in the past)
  rpm      numeric;
  cust_rate numeric;
  carr_rate numeric;
  stage_key text;
  covered  boolean;
  pu_ts    timestamp;    -- naive wall-clock at the dock
  de_ts    timestamp;
begin
  -- Active carriers, stable order, so we can round-robin them.
  select count(*) into n_active from public.carriers where status = 'active';

  -- Every lane: a customer, their fixed pickup facility, and one destination.
  create temporary table _lane on commit drop as
  select row_number() over (order by customer, ord) - 1 as ord0, *
  from (
    values
      -- Acme Foods — Marietta, GA
      ('Acme Foods', 1, 'Acme Foods DC',        '1800 Industrial Blvd', 'Marietta', 'GA', '30062', 'Lone Star Cold Storage', '4400 Irving Blvd', 'Dallas',          'TX', '75247', 782),
      ('Acme Foods', 2, 'Acme Foods DC',        '1800 Industrial Blvd', 'Marietta', 'GA', '30062', 'Memphis Regional DC',    '5500 Shelby Dr',   'Memphis',         'TN', '38118', 382),
      ('Acme Foods', 3, 'Acme Foods DC',        '1800 Industrial Blvd', 'Marietta', 'GA', '30062', 'Carolina Packaging',     '215 Distribution', 'Concord',         'NC', '28027', 245),
      ('Acme Foods', 4, 'Acme Foods DC',        '1800 Industrial Blvd', 'Marietta', 'GA', '30062', 'Gulf Foods Terminal',    '90 Port Rd',       'Houston',         'TX', '77002', 789),
      -- Blue Ridge Produce — Savannah, GA
      ('Blue Ridge Produce', 1, 'Blue Ridge Packhouse', '10 Grower Way', 'Savannah', 'GA', '31407', 'Memphis Regional DC', '5500 Shelby Dr', 'Memphis',   'TN', '38118', 610),
      ('Blue Ridge Produce', 2, 'Blue Ridge Packhouse', '10 Grower Way', 'Savannah', 'GA', '31407', 'Carolina Packaging',  '215 Distribution','Concord',   'NC', '28027', 290),
      ('Blue Ridge Produce', 3, 'Blue Ridge Packhouse', '10 Grower Way', 'Savannah', 'GA', '31407', 'Peachtree Market',    '55 Fulton Ave',   'Atlanta',   'GA', '30303', 250),
      -- Lone Star Distribution — Dallas, TX
      ('Lone Star Distribution', 1, 'Lone Star DC', '7000 Trade St', 'Dallas', 'TX', '75247', 'Gulf Foods Terminal', '90 Port Rd',   'Houston',        'TX', '77002', 240),
      ('Lone Star Distribution', 2, 'Lone Star DC', '7000 Trade St', 'Dallas', 'TX', '75247', 'Peachtree Market',    '55 Fulton Ave','Atlanta',        'GA', '30303', 781),
      ('Lone Star Distribution', 3, 'Lone Star DC', '7000 Trade St', 'Dallas', 'TX', '75247', 'Wasatch Distribution','2200 W 1500 S','Salt Lake City', 'UT', '84104', 999),
      -- Great Lakes Paper — Joliet, IL
      ('Great Lakes Paper', 1, 'Great Lakes Mill', '900 Mill Rd', 'Joliet', 'IL', '60436', 'Carolina Packaging',  '215 Distribution','Concord', 'NC', '28027', 740),
      ('Great Lakes Paper', 2, 'Great Lakes Mill', '900 Mill Rd', 'Joliet', 'IL', '60436', 'Memphis Regional DC', '5500 Shelby Dr',  'Memphis', 'TN', '38118', 535),
      ('Great Lakes Paper', 3, 'Great Lakes Mill', '900 Mill Rd', 'Joliet', 'IL', '60436', 'Lone Star Cold Storage','4400 Irving Blvd','Dallas','TX', '75247', 925),
      -- Pacific Coast Imports — Ontario, CA
      ('Pacific Coast Imports', 1, 'PCI Import Center', '12000 Riverside Dr', 'Ontario', 'CA', '91761', 'Wasatch Distribution', '2200 W 1500 S', 'Salt Lake City', 'UT', '84104', 690),
      ('Pacific Coast Imports', 2, 'PCI Import Center', '12000 Riverside Dr', 'Ontario', 'CA', '91761', 'Mile High Freight',    '4100 Vasquez',  'Denver',         'CO', '80216', 1015),
      ('Pacific Coast Imports', 3, 'PCI Import Center', '12000 Riverside Dr', 'Ontario', 'CA', '91761', 'Lone Star Cold Storage','4400 Irving Blvd','Dallas',       'TX', '75247', 1450)
  ) as t(customer, ord, pu_name, pu_addr, pu_city, pu_state, pu_zip,
         de_name, de_addr, de_city, de_state, de_zip, miles);

  select count(*) into n_lanes from _lane;

  -- 24 loads, walking the lanes in order and repeating.
  for i in 0..23 loop
    select * into r from _lane where ord0 = (i % n_lanes);

    -- Spread dates from ~32 days ago to ~two weeks out. The split lands a
    -- working board: history for the reports page, plus live booked and
    -- uncovered loads to act on (and to build a tender template from).
    d := 32 - i * 2;

    if    d > 7  then stage_key := 'delivered';
    elsif d >= 3 then stage_key := 'in_transit';
    elsif d >= 0 then stage_key := 'booked';
    else              stage_key := 'available';
    end if;
    covered := stage_key <> 'available';

    select id into v_stage from public.pipeline_stages where key = stage_key;
    select id into v_cust  from public.customers where lower(name) = lower(r.customer) limit 1;
    if covered then
      select id into v_carr from public.carriers
        where status = 'active' order by dot_number offset (i % n_active) limit 1;
    else
      v_carr := null;
    end if;

    rpm       := 2.4 + ((i * 7) % 10)::numeric / 10;
    cust_rate := round(r.miles * rpm + 120);
    carr_rate := case when covered then round(cust_rate * 0.82) else null end;

    v_pu_metro := public.resolve_metro(r.pu_city, r.pu_state, r.pu_zip);
    v_de_metro := public.resolve_metro(r.de_city, r.de_state, r.de_zip);
    v_pu_tz    := public.stop_timezone(v_pu_metro);
    v_de_tz    := public.stop_timezone(v_de_metro);

    pu_ts := (current_date - d)::timestamp + time '08:00';
    de_ts := pu_ts + interval '30 hours';   -- next day ~14:00

    insert into public.loads (
      pipeline_stage_id, source, is_test, customer_id, carrier_id,
      shipment_id, commodity, equipment_type_text, equipment_length_ft,
      total_weight, weight_uom, total_quantity, distance_miles,
      customer_rate, carrier_rate, currency, notes,
      booked_at, in_transit_at, delivered_at
    ) values (
      v_stage, 'manual', false, v_cust, v_carr,
      'DEMO-' || to_char(1000 + i, 'FM0000'),
      (array['Frozen poultry','Corrugated sheets','Consumer goods','Produce, refrigerated','Canned goods'])[1 + (i % 5)],
      case when (i % 3) = 0 then 'Reefer 53ft' else 'Dry van 53ft' end,
      53,
      38000 + (i % 6) * 1200, 'L', 20 + (i % 6), r.miles,
      cust_rate, carr_rate, 'USD',
      'Demo load — safe to delete (shipment id starts with DEMO-).',
      case when covered                              then (pu_ts - interval '1 day') at time zone v_pu_tz else null end,
      case when stage_key in ('in_transit','delivered') then pu_ts at time zone v_pu_tz else null end,
      case when stage_key = 'delivered'              then de_ts at time zone v_de_tz else null end
    )
    returning id into v_load;

    -- Pickup
    insert into public.load_stops (
      load_id, sequence, stop_type, name, address1, city, state, postal, country,
      metro_id, timezone, appointment, earliest, latest, instructions,
      actual_arrival
    ) values (
      v_load, 1, 'pickup', r.pu_name, r.pu_addr, r.pu_city, r.pu_state, r.pu_zip, 'US',
      v_pu_metro, v_pu_tz,
      pu_ts at time zone v_pu_tz, pu_ts at time zone v_pu_tz,
      (pu_ts + interval '4 hours') at time zone v_pu_tz,
      'Check in at guard shack. Live load. No lumper.',
      case when stage_key = 'delivered' then (pu_ts + interval '35 minutes') at time zone v_pu_tz else null end
    );

    -- Delivery
    insert into public.load_stops (
      load_id, sequence, stop_type, name, address1, city, state, postal, country,
      metro_id, timezone, appointment, earliest, latest, instructions,
      actual_arrival
    ) values (
      v_load, 2, 'delivery', r.de_name, r.de_addr, r.de_city, r.de_state, r.de_zip, 'US',
      v_de_metro, v_de_tz,
      de_ts at time zone v_de_tz, de_ts at time zone v_de_tz,
      (de_ts + interval '4 hours') at time zone v_de_tz,
      'Appointment required. PO on the BOL.',
      case when stage_key = 'delivered' then (de_ts + interval '10 minutes') at time zone v_de_tz else null end
    );

    -- A couple of reference numbers per load.
    insert into public.load_references (load_id, qualifier, value, label) values
      (v_load, 'PO',  'PO-' || to_char(40000 + i, 'FM00000'), 'PO'),
      (v_load, 'BOL', 'BOL-' || to_char(90000 + i, 'FM00000'), 'BOL');
  end loop;
end $$;

commit;

-- A quick summary so the runner log shows what landed.
select
  (select count(*) from public.customers)                                   as customers,
  (select count(*) from public.carriers)                                    as carriers,
  (select count(*) from public.loads where shipment_id like 'DEMO-%')       as demo_loads,
  (select count(*) from public.customer_location_history)                   as learned_locations;
