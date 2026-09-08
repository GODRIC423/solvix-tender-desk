/**
 * The numbers behind the reports page.
 *
 * Pure functions over `v_report_loads` rows so every figure on the page is
 * testable without a database, and so "how is run rate calculated?" has a
 * single answer that lives here rather than in JSX.
 *
 * Definitions (the ones the owner asked for, made precise):
 *
 *   revenue          sum of customer_rate over loads in the period
 *   carrier cost     sum of carrier_rate over covered loads in the period
 *   gross profit     sum of (customer_rate - carrier_rate) over COVERED loads -
 *                    a load with no carrier has no cost yet, so counting its
 *                    whole rate as profit would flatter the number
 *   profit / load    mean gross profit over covered loads
 *   margin / load    mean of (profit / customer_rate) over covered loads
 *   run rate         revenue in the period, scaled to a year (and a month)
 *   runway           cash on hand / (monthly overhead - monthly gross profit);
 *                    "profitable" when gross profit covers overhead
 *
 * A load is "in the period" by its first pickup date, falling back to when it
 * was created. Cancelled loads are out. Test loads never reach this code -
 * the view excludes them.
 */

import type { ReportLoad } from '@/types/db'

export interface DateRange {
  /** Inclusive, ISO. */
  from: string
  /** Exclusive, ISO. */
  to: string
}

export interface Kpis {
  loads: number
  covered: number
  delivered: number
  revenue: number
  carrierCost: number
  grossProfit: number
  avgProfitPerLoad: number | null
  avgMarginPct: number | null
  weightedMarginPct: number | null
  avgRevenuePerMile: number | null
  /** Revenue scaled to a 365-day year. */
  annualRunRate: number
  monthlyRunRate: number
  monthlyGrossProfit: number
  days: number
}

export interface Runway {
  status: 'unknown' | 'profitable' | 'burning'
  /** Months of cash left, when burning. */
  months: number | null
  monthlyNetBurn: number | null
}

export interface WeekPoint {
  /** ISO date of the Monday starting the week. */
  week: string
  label: string
  loads: number
  revenue: number
  carrierCost: number
  grossProfit: number
  marginPct: number | null
}

export interface CustomerRow {
  customer_id: string | null
  name: string
  loads: number
  revenue: number
  grossProfit: number
  marginPct: number | null
}

export interface LaneRow {
  lane: string
  loads: number
  revenue: number
  avgRevenuePerMile: number | null
  avgMiles: number | null
}

export interface ReportSummary {
  kpis: Kpis
  runway: Runway
  weekly: WeekPoint[]
  customers: CustomerRow[]
  lanes: LaneRow[]
}

const DAY = 86_400_000

export function periodDate(l: ReportLoad): string {
  return l.first_pickup_at ?? l.created_at
}

/** Loads that count: in range, not cancelled. */
export function inPeriod(loads: ReportLoad[], range: DateRange): ReportLoad[] {
  const from = new Date(range.from).getTime()
  const to = new Date(range.to).getTime()
  return loads.filter((l) => {
    if (l.stage_key === 'cancelled') return false
    const t = new Date(periodDate(l)).getTime()
    return t >= from && t < to
  })
}

function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0)
}
function mean(xs: number[]): number | null {
  return xs.length ? sum(xs) / xs.length : null
}

export function kpisFor(loads: ReportLoad[], range: DateRange): Kpis {
  const days = Math.max(1, (new Date(range.to).getTime() - new Date(range.from).getTime()) / DAY)
  const priced = loads.filter((l) => l.customer_rate !== null)
  const covered = loads.filter((l) => l.customer_rate !== null && l.carrier_rate !== null)

  const revenue = sum(priced.map((l) => l.customer_rate as number))
  const carrierCost = sum(covered.map((l) => l.carrier_rate as number))
  const profits = covered.map((l) => (l.customer_rate as number) - (l.carrier_rate as number))
  const grossProfit = sum(profits)
  const coveredRevenue = sum(covered.map((l) => l.customer_rate as number))

  const marginPcts = covered
    .filter((l) => (l.customer_rate as number) > 0)
    .map((l) => ((l.customer_rate as number) - (l.carrier_rate as number)) / (l.customer_rate as number))

  const rpm = priced
    .filter((l) => l.distance_miles !== null && l.distance_miles > 0)
    .map((l) => (l.customer_rate as number) / (l.distance_miles as number))

  return {
    loads: loads.length,
    covered: covered.length,
    delivered: loads.filter((l) => l.delivered_at !== null).length,
    revenue,
    carrierCost,
    grossProfit,
    avgProfitPerLoad: mean(profits),
    avgMarginPct: mean(marginPcts),
    weightedMarginPct: coveredRevenue > 0 ? grossProfit / coveredRevenue : null,
    avgRevenuePerMile: mean(rpm),
    annualRunRate: (revenue / days) * 365,
    monthlyRunRate: (revenue / days) * 30.4375,
    monthlyGrossProfit: (grossProfit / days) * 30.4375,
    days,
  }
}

export function runwayFor(
  kpis: Kpis,
  cashOnHand: number | null,
  monthlyOverhead: number | null,
): Runway {
  if (cashOnHand === null || monthlyOverhead === null) {
    return { status: 'unknown', months: null, monthlyNetBurn: null }
  }
  const netBurn = monthlyOverhead - kpis.monthlyGrossProfit
  if (netBurn <= 0) return { status: 'profitable', months: null, monthlyNetBurn: netBurn }
  return { status: 'burning', months: cashOnHand / netBurn, monthlyNetBurn: netBurn }
}

/** Monday 00:00 UTC of the week containing `iso`, as YYYY-MM-DD. */
export function weekStart(iso: string): string {
  const d = new Date(iso)
  const day = (d.getUTCDay() + 6) % 7 // Mon=0 … Sun=6
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day))
  return monday.toISOString().slice(0, 10)
}

function weekLabel(ymd: string): string {
  const d = new Date(ymd + 'T00:00:00Z')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

/** One point per week across the whole range, zeros where nothing happened. */
export function weeklyFor(loads: ReportLoad[], range: DateRange): WeekPoint[] {
  const buckets = new Map<string, WeekPoint>()
  // Seed every week in range so gaps show as zero rather than vanishing.
  for (
    let cursor = new Date(weekStart(range.from) + 'T00:00:00Z');
    cursor.getTime() < new Date(range.to).getTime();
    cursor = new Date(cursor.getTime() + 7 * DAY)
  ) {
    const key = cursor.toISOString().slice(0, 10)
    buckets.set(key, {
      week: key,
      label: weekLabel(key),
      loads: 0,
      revenue: 0,
      carrierCost: 0,
      grossProfit: 0,
      marginPct: null,
    })
  }

  for (const l of loads) {
    const key = weekStart(periodDate(l))
    const b = buckets.get(key)
    if (!b) continue
    b.loads += 1
    if (l.customer_rate !== null) b.revenue += l.customer_rate
    if (l.customer_rate !== null && l.carrier_rate !== null) {
      b.carrierCost += l.carrier_rate
      b.grossProfit += l.customer_rate - l.carrier_rate
    }
  }

  const out = [...buckets.values()].sort((a, b) => a.week.localeCompare(b.week))
  for (const b of out) {
    const coveredRevenue = b.revenue > 0 && b.carrierCost > 0 ? b.grossProfit + b.carrierCost : 0
    b.marginPct = coveredRevenue > 0 ? b.grossProfit / coveredRevenue : null
  }
  return out
}

export function customersFor(loads: ReportLoad[], limit = 8): CustomerRow[] {
  const map = new Map<string, CustomerRow & { coveredRevenue: number }>()
  for (const l of loads) {
    const key = l.customer_id ?? '∅'
    const row =
      map.get(key) ??
      ({
        customer_id: l.customer_id,
        name: l.customer_name ?? 'No customer set',
        loads: 0,
        revenue: 0,
        grossProfit: 0,
        marginPct: null,
        coveredRevenue: 0,
      } as CustomerRow & { coveredRevenue: number })
    row.loads += 1
    if (l.customer_rate !== null) row.revenue += l.customer_rate
    if (l.customer_rate !== null && l.carrier_rate !== null) {
      row.grossProfit += l.customer_rate - l.carrier_rate
      row.coveredRevenue += l.customer_rate
    }
    map.set(key, row)
  }
  return [...map.values()]
    .map((r) => ({
      customer_id: r.customer_id,
      name: r.name,
      loads: r.loads,
      revenue: r.revenue,
      grossProfit: r.grossProfit,
      marginPct: r.coveredRevenue > 0 ? r.grossProfit / r.coveredRevenue : null,
    }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, limit)
}

export function lanesFor(loads: ReportLoad[], limit = 8): LaneRow[] {
  const map = new Map<string, { loads: number; revenue: number; rpm: number[]; miles: number[] }>()
  for (const l of loads) {
    const o = l.origin_metro_name ?? (l.origin_city ? `${l.origin_city}, ${l.origin_state}` : null)
    const d = l.dest_metro_name ?? (l.dest_city ? `${l.dest_city}, ${l.dest_state}` : null)
    if (!o || !d) continue
    const key = `${o} → ${d}`
    const row = map.get(key) ?? { loads: 0, revenue: 0, rpm: [], miles: [] }
    row.loads += 1
    if (l.customer_rate !== null) row.revenue += l.customer_rate
    if (l.revenue_per_mile !== null) row.rpm.push(l.revenue_per_mile)
    if (l.distance_miles !== null) row.miles.push(l.distance_miles)
    map.set(key, row)
  }
  return [...map.entries()]
    .map(([lane, r]) => ({
      lane,
      loads: r.loads,
      revenue: r.revenue,
      avgRevenuePerMile: mean(r.rpm),
      avgMiles: mean(r.miles),
    }))
    .sort((a, b) => b.loads - a.loads || b.revenue - a.revenue)
    .slice(0, limit)
}

export function summarize(
  allLoads: ReportLoad[],
  range: DateRange,
  financials: { cash_on_hand: number | null; monthly_overhead: number | null },
): ReportSummary {
  const loads = inPeriod(allLoads, range)
  const kpis = kpisFor(loads, range)
  return {
    kpis,
    runway: runwayFor(kpis, financials.cash_on_hand, financials.monthly_overhead),
    weekly: weeklyFor(loads, range),
    customers: customersFor(loads),
    lanes: lanesFor(loads),
  }
}

/** Preset ranges, all ending now. */
export function presetRange(preset: '7d' | '30d' | '90d' | 'mtd' | 'ytd' | '12m', now = new Date()): DateRange {
  const to = new Date(now.getTime() + DAY).toISOString() // through end of today
  const start = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString()
  switch (preset) {
    case '7d':
      return { from: start(new Date(now.getTime() - 6 * DAY)), to }
    case '30d':
      return { from: start(new Date(now.getTime() - 29 * DAY)), to }
    case '90d':
      return { from: start(new Date(now.getTime() - 89 * DAY)), to }
    case 'mtd':
      return { from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString(), to }
    case 'ytd':
      return { from: new Date(Date.UTC(now.getUTCFullYear(), 0, 1)).toISOString(), to }
    case '12m':
      return { from: new Date(Date.UTC(now.getUTCFullYear() - 1, now.getUTCMonth(), now.getUTCDate())).toISOString(), to }
  }
}

/** $1,284 / $12.9K / $4.2M — auto-compact for tiles. */
export function compactMoney(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  const abs = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`
  if (abs >= 10_000) return `${sign}$${(abs / 1_000).toFixed(abs >= 100_000 ? 0 : 1)}K`
  return `${sign}$${Math.round(abs).toLocaleString('en-US')}`
}

export function pct(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  return `${(n * 100).toFixed(digits)}%`
}
