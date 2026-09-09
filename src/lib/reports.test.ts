import { describe, expect, it } from 'vitest'
import {
  compactMoney,
  inPeriod,
  kpisFor,
  runwayFor,
  summarize,
  weekStart,
  weeklyFor,
} from './reports'
import type { ReportLoad } from '@/types/db'

const RANGE = { from: '2026-03-01T00:00:00Z', to: '2026-03-31T00:00:00Z' } // 30 days

function load(o: Partial<ReportLoad>): ReportLoad {
  return {
    id: Math.random().toString(36).slice(2),
    load_number: 'S2600001',
    created_at: '2026-03-10T12:00:00Z',
    first_pickup_at: '2026-03-10T12:00:00Z',
    last_delivery_at: null,
    delivered_at: null,
    invoiced_at: null,
    paid_at: null,
    cancelled_at: null,
    stage_key: 'booked',
    stage_label: 'Booked',
    stage_is_booked: true,
    stage_is_terminal: false,
    customer_id: 'c1',
    customer_name: 'Acme',
    carrier_id: 'k1',
    carrier_name: 'Fast Freight',
    customer_rate: 2000,
    carrier_rate: 1500,
    margin: 500,
    margin_pct: 0.25,
    distance_miles: 800,
    revenue_per_mile: 2.5,
    origin_city: 'Marietta',
    origin_state: 'GA',
    origin_metro_name: 'Atlanta, GA',
    dest_city: 'Dallas',
    dest_state: 'TX',
    dest_metro_name: 'Dallas-Fort Worth, TX',
    equipment_type_text: 'Dry van',
    source: 'manual',
    ...o,
  }
}

describe('what counts as in the period', () => {
  it('uses the pickup date, not the created date', () => {
    const l = load({ created_at: '2026-02-01T00:00:00Z', first_pickup_at: '2026-03-15T00:00:00Z' })
    expect(inPeriod([l], RANGE)).toHaveLength(1)
  })

  it('falls back to created when there is no pickup yet', () => {
    const l = load({ created_at: '2026-03-15T00:00:00Z', first_pickup_at: null })
    expect(inPeriod([l], RANGE)).toHaveLength(1)
  })

  it('leaves cancelled loads out', () => {
    expect(inPeriod([load({ stage_key: 'cancelled' })], RANGE)).toHaveLength(0)
  })

  it('is inclusive at the start and exclusive at the end', () => {
    expect(inPeriod([load({ first_pickup_at: RANGE.from })], RANGE)).toHaveLength(1)
    expect(inPeriod([load({ first_pickup_at: RANGE.to })], RANGE)).toHaveLength(0)
  })
})

describe('kpis', () => {
  it('only counts profit on covered loads', () => {
    const k = kpisFor([load({}), load({ carrier_rate: null, margin: 2000 })], RANGE)
    expect(k.loads).toBe(2)
    expect(k.covered).toBe(1)
    expect(k.revenue).toBe(4000) // both have a customer rate
    expect(k.grossProfit).toBe(500) // only the covered one
    expect(k.avgProfitPerLoad).toBe(500)
  })

  it('averages margin per load, and also weights it', () => {
    const k = kpisFor(
      [load({ customer_rate: 1000, carrier_rate: 500 }), load({ customer_rate: 3000, carrier_rate: 2700 })],
      RANGE,
    )
    expect(k.avgMarginPct).toBeCloseTo((0.5 + 0.1) / 2)
    expect(k.weightedMarginPct).toBeCloseTo(800 / 4000)
  })

  it('scales revenue to a year from the period length', () => {
    const k = kpisFor([load({ customer_rate: 3000 })], RANGE)
    expect(k.days).toBe(30)
    expect(k.annualRunRate).toBeCloseTo((3000 / 30) * 365)
  })

  it('reports nulls, not zeros, when there is nothing to average', () => {
    const k = kpisFor([], RANGE)
    expect(k.avgProfitPerLoad).toBeNull()
    expect(k.avgMarginPct).toBeNull()
    expect(k.revenue).toBe(0)
  })
})

describe('runway', () => {
  const k = kpisFor([load({ customer_rate: 30000, carrier_rate: 20000 })], RANGE) // GP ≈ 10,147/mo

  it('is unknown without the two inputs', () => {
    expect(runwayFor(k, null, 5000).status).toBe('unknown')
    expect(runwayFor(k, 50000, null).status).toBe('unknown')
  })

  it('is profitable when gross profit covers overhead', () => {
    expect(runwayFor(k, 50000, 8000).status).toBe('profitable')
  })

  it('divides cash by net burn otherwise', () => {
    const r = runwayFor(k, 50000, 20000)
    expect(r.status).toBe('burning')
    expect(r.monthlyNetBurn).toBeCloseTo(20000 - k.monthlyGrossProfit)
    expect(r.months).toBeCloseTo(50000 / (20000 - k.monthlyGrossProfit))
  })
})

describe('weekly buckets', () => {
  it('starts weeks on Monday', () => {
    expect(weekStart('2026-03-11T15:00:00Z')).toBe('2026-03-09') // a Wednesday
    expect(weekStart('2026-03-09T00:00:00Z')).toBe('2026-03-09') // the Monday itself
    expect(weekStart('2026-03-08T23:59:00Z')).toBe('2026-03-02') // Sunday belongs to the prior week
  })

  it('emits a zero week rather than skipping it', () => {
    // March 1 2026 is a Sunday, so the range opens mid-week: the first bucket
    // is the week of Feb 23, and a March 3 load lands in the week of March 2.
    const w = weeklyFor([load({ first_pickup_at: '2026-03-03T00:00:00Z' })], RANGE)
    expect(w[0].week).toBe('2026-02-23')
    expect(w.length).toBeGreaterThanOrEqual(5)
    const hit = w.find((x) => x.week === '2026-03-02')!
    const next = w.find((x) => x.week === '2026-03-09')!
    expect(hit.loads).toBe(1)
    expect(next.loads).toBe(0)
    expect(next.revenue).toBe(0)
  })

  it('computes a weighted margin per week', () => {
    const w = weeklyFor(
      [
        load({ first_pickup_at: '2026-03-03T00:00:00Z', customer_rate: 1000, carrier_rate: 800 }),
        load({ first_pickup_at: '2026-03-04T00:00:00Z', customer_rate: 1000, carrier_rate: 600 }),
      ],
      RANGE,
    )
    const wk = w.find((x) => x.week === '2026-03-02')!
    expect(wk.grossProfit).toBe(600)
    expect(wk.marginPct).toBeCloseTo(600 / 2000)
  })
})

describe('summary', () => {
  it('ranks customers by revenue and lanes by volume', () => {
    const s = summarize(
      [
        load({ customer_id: 'a', customer_name: 'A', customer_rate: 100 }),
        load({ customer_id: 'b', customer_name: 'B', customer_rate: 900 }),
        load({ customer_id: 'b', customer_name: 'B', customer_rate: 900, dest_metro_name: 'Memphis, TN' }),
      ],
      RANGE,
      { cash_on_hand: null, monthly_overhead: null },
    )
    expect(s.customers[0].name).toBe('B')
    expect(s.customers[0].loads).toBe(2)
    expect(s.lanes[0].lane).toBe('Atlanta, GA → Dallas-Fort Worth, TX')
    expect(s.lanes[0].loads).toBe(2)
  })
})

describe('compact money', () => {
  it('reads the way a tile should', () => {
    expect(compactMoney(1284)).toBe('$1,284')
    expect(compactMoney(12900)).toBe('$12.9K')
    expect(compactMoney(4_200_000)).toBe('$4.2M')
    expect(compactMoney(-500)).toBe('-$500')
    expect(compactMoney(null)).toBe('—')
  })
})
