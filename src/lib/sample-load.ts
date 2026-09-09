/**
 * A believable throwaway load.
 *
 * "I can't really give you good feedback on this until I am able to put a
 * fake load in there." So: one click makes a load that exercises everything
 * the board does — a real lane between two metros the desk knows, a pickup
 * far enough out to land yellow, rates that produce a margin, a temp range,
 * a couple of reference numbers. It is marked is_test so it wears a badge and
 * stays out of every report.
 */

import type { ManualLoadInput, ManualStopInput } from '@/hooks/useLoads'

interface Lane {
  origin: { name: string; address1: string; city: string; state: string; postal: string }
  dest: { name: string; address1: string; city: string; state: string; postal: string }
  miles: number
  commodity: string
  equipment: string
  temp?: [number, number]
}

// Every city here is a metro name or alias in the seed, so the sample
// resolves metros and timezones the way a real tender would.
const LANES: Lane[] = [
  {
    origin: { name: 'Southern Poultry DC', address1: '1800 Industrial Blvd', city: 'Marietta', state: 'GA', postal: '30062' },
    dest: { name: 'Lone Star Cold Storage', address1: '4400 Irving Blvd', city: 'Dallas', state: 'TX', postal: '75247' },
    miles: 782,
    commodity: 'Frozen poultry, 22 pallets',
    equipment: 'Reefer 53ft',
    temp: [-10, 0],
  },
  {
    origin: { name: 'Midwest Paper Mill', address1: '900 Mill Rd', city: 'Joliet', state: 'IL', postal: '60436' },
    dest: { name: 'Carolina Packaging', address1: '215 Distribution Dr', city: 'Concord', state: 'NC', postal: '28027' },
    miles: 740,
    commodity: 'Corrugated sheets, 26 pallets',
    equipment: 'Dry van 53ft',
  },
  {
    origin: { name: 'Inland Empire Fulfillment', address1: '12000 Riverside Dr', city: 'Ontario', state: 'CA', postal: '91761' },
    dest: { name: 'Salt Lake Distribution', address1: '2200 W 1500 S', city: 'Salt Lake City', state: 'UT', postal: '84104' },
    miles: 690,
    commodity: 'Consumer goods, floor loaded',
    equipment: 'Dry van 53ft',
  },
  {
    origin: { name: 'Port Wentworth Transload', address1: '10 Container Way', city: 'Savannah', state: 'GA', postal: '31407' },
    dest: { name: 'Memphis Regional DC', address1: '5500 Shelby Dr', city: 'Memphis', state: 'TN', postal: '38118' },
    miles: 610,
    commodity: 'Tile, 18 pallets — heavy',
    equipment: 'Dry van 53ft',
  },
]

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** `YYYY-MM-DDTHH:mm` for a datetime-local field, `hoursFromNow` out, snapped to the hour. */
function localIn(hoursFromNow: number, hour: number): string {
  const d = new Date(Date.now() + hoursFromNow * 3_600_000)
  d.setMinutes(0, 0, 0)
  d.setHours(hour)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export interface SampleLoad {
  load: ManualLoadInput
  stops: ManualStopInput[]
}

export function makeSampleLoad(seed = Date.now()): SampleLoad {
  const lane = LANES[Math.abs(seed) % LANES.length]
  // ~30h out: lands in the yellow band on default rules, so the colour is
  // visible without being alarming.
  const pickup = localIn(30, 8)
  const delivery = localIn(30 + 36, 14)
  const customerRate = Math.round(lane.miles * 2.85 + 150)
  const carrierRate = Math.round(lane.miles * 2.2 + 100)
  const ref = String(100000 + (Math.abs(seed) % 900000))

  return {
    load: {
      is_test: true,
      shipment_id: `TEST-${ref}`,
      equipment_type_text: lane.equipment,
      equipment_length_ft: 53,
      temp_min: lane.temp?.[0] ?? null,
      temp_max: lane.temp?.[1] ?? null,
      commodity: lane.commodity,
      total_weight: 42000,
      weight_uom: 'L',
      total_quantity: 22,
      distance_miles: lane.miles,
      hazmat: false,
      customer_rate: customerRate,
      carrier_rate: carrierRate,
      notes:
        'TEST LOAD — made from the "create a test load" button. Safe to delete. ' +
        'Driver must call 1h out. No lumper. PO on BOL required.',
      stage_key: 'available',
    },
    stops: [
      {
        stop_type: 'pickup',
        ...lane.origin,
        contact_name: 'Shipping office',
        phone: '(770) 555-0142',
        appointment_local: pickup,
        earliest_local: pickup,
        latest_local: localIn(30, 12),
        instructions: 'Check in at guard shack. Live load, ~2h.',
      },
      {
        stop_type: 'delivery',
        ...lane.dest,
        contact_name: 'Receiving',
        phone: '(214) 555-0199',
        appointment_local: delivery,
        earliest_local: delivery,
        latest_local: localIn(30 + 36, 18),
        instructions: 'Appointment required. Drop trailer not allowed.',
      },
    ],
  }
}
