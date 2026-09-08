import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useAuth } from '@/hooks/useAuth'
import { useSettings } from '@/hooks/useSettings'
import { useReportLoads } from '@/hooks/useReports'
import { compactMoney, pct, presetRange, summarize, type WeekPoint } from '@/lib/reports'
import Toggle from '@/components/Toggle'

/**
 * Chart colours. Validated with the dataviz palette script against the card
 * surface (#0f141b) in dark mode: adjacent and all-pairs CVD Delta E 9.4,
 * normal-vision 20.9+, every slot >= 3:1 contrast. Colour follows the
 * entity across every chart on this page: revenue is always blue, carrier
 * cost always orange, profit always aqua.
 */
const C = {
  surface: '#0f141b',
  grid: '#243040',
  axis: '#324256',
  ink: '#e2e8f0',
  muted: '#94a3b8',
  revenue: '#3987e5',
  cost: '#d95926',
  profit: '#199e70',
}

type Preset = '7d' | '30d' | '90d' | 'mtd' | 'ytd' | '12m'
const PRESETS: Array<{ key: Preset; label: string }> = [
  { key: '7d', label: 'Last 7 days' },
  { key: '30d', label: 'Last 30 days' },
  { key: '90d', label: 'Last 90 days' },
  { key: 'mtd', label: 'Month to date' },
  { key: 'ytd', label: 'Year to date' },
  { key: '12m', label: 'Last 12 months' },
]

export default function Reports() {
  const { can } = useAuth()
  const { data: settings } = useSettings()
  const [preset, setPreset] = useState<Preset>('30d')
  const [showTable, setShowTable] = useState(false)
  const range = useMemo(() => presetRange(preset), [preset])
  const { data: loads, isLoading, isFetching, error } = useReportLoads(range)

  const summary = useMemo(
    () =>
      summarize(loads ?? [], range, settings?.financials ?? { cash_on_hand: null, monthly_overhead: null }),
    [loads, range, settings?.financials],
  )

  if (!can('view_reports')) {
    return (
      <div className="p-6">
        <div className="card border-band-yellow/40 bg-band-yellow/10 p-3 text-sm text-amber-200">
          Your account can&apos;t see reports. An admin can turn that on under Users.
        </div>
      </div>
    )
  }

  const { kpis, runway, weekly, customers, lanes } = summary
  const empty = !isLoading && kpis.loads === 0

  return (
    <div className="p-4">
      {/* ------------------------------------------------------- filters */}
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold text-slate-100">Reports</h1>
        <div className="flex flex-wrap items-center gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              onClick={() => setPreset(p.key)}
              className={`rounded-full border px-2.5 py-1 text-xs font-medium transition ${
                preset === p.key
                  ? 'border-accent/50 bg-accent/15 text-accent'
                  : 'border-ink-600 bg-ink-800 text-slate-300 hover:bg-ink-700'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-3 text-xs text-slate-400">
          <span>
            {kpis.loads} load{kpis.loads === 1 ? '' : 's'} · {kpis.covered} covered · test loads excluded
          </span>
          <Toggle size="sm" tone="accent" checked={showTable} onChange={setShowTable} label={<span className="text-xs font-normal text-slate-300">Table</span>} />
        </div>
      </div>

      {error && (
        <div className="card mb-3 border-band-red/40 bg-band-red/10 p-3 text-sm text-red-300">
          {(error as Error).message}
        </div>
      )}

      {empty && (
        <div className="card mb-3 p-3 text-sm text-slate-400">
          No loads in this period. Reports fill in as loads with rates come through the board.
        </div>
      )}

      {/* Hold the previous render at reduced opacity on refetch — no layout jump. */}
      <div className={`transition-opacity ${isFetching && !isLoading ? 'opacity-60' : ''}`}>
        {/* ------------------------------------------------------- kpis */}
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <Tile label="Revenue" value={compactMoney(kpis.revenue)} sub={`${kpis.days.toFixed(0)}-day period`} />
          <Tile
            label="Gross profit"
            value={compactMoney(kpis.grossProfit)}
            sub={kpis.covered > 0 ? `${pct(kpis.weightedMarginPct)} of covered revenue` : 'no covered loads yet'}
          />
          <Tile
            label="Avg profit per load"
            value={compactMoney(kpis.avgProfitPerLoad)}
            sub={kpis.covered > 0 ? `over ${kpis.covered} covered load${kpis.covered === 1 ? '' : 's'}` : 'needs a carrier rate'}
          />
          <Tile
            label="Avg margin per load"
            value={pct(kpis.avgMarginPct)}
            sub={kpis.avgRevenuePerMile !== null ? `$${kpis.avgRevenuePerMile.toFixed(2)} / mile revenue` : '—'}
          />
          <Tile
            label="Revenue run rate"
            value={compactMoney(kpis.annualRunRate)}
            sub={`${compactMoney(kpis.monthlyRunRate)} / month, annualised`}
          />
          <RunwayTile runway={runway} monthlyGrossProfit={kpis.monthlyGrossProfit} />
        </div>

        {/* ----------------------------------------------------- charts */}
        <div className="mb-4 grid gap-4 lg:grid-cols-2">
          <ChartCard
            title="Revenue and carrier cost by week"
            legend={[
              { label: 'Revenue', color: C.revenue },
              { label: 'Carrier cost', color: C.cost },
            ]}
          >
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={weekly} margin={{ top: 12, right: 16, bottom: 4, left: 0 }}>
                <CartesianGrid stroke={C.grid} vertical={false} />
                <XAxis dataKey="label" tick={{ fill: C.muted, fontSize: 11 }} axisLine={{ stroke: C.axis }} tickLine={false} />
                <YAxis
                  tickFormatter={(v: number) => compactMoney(v)}
                  tick={{ fill: C.muted, fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  width={60}
                />
                <Tooltip content={<WeekTip />} cursor={{ stroke: C.axis }} />
                <Line
                  type="monotone"
                  dataKey="revenue"
                  name="Revenue"
                  stroke={C.revenue}
                  strokeWidth={2}
                  dot={{ r: 4, fill: C.revenue, stroke: C.surface, strokeWidth: 2 }}
                  activeDot={{ r: 5, stroke: C.surface, strokeWidth: 2 }}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="carrierCost"
                  name="Carrier cost"
                  stroke={C.cost}
                  strokeWidth={2}
                  dot={{ r: 4, fill: C.cost, stroke: C.surface, strokeWidth: 2 }}
                  activeDot={{ r: 5, stroke: C.surface, strokeWidth: 2 }}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Gross profit by week">
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={weekly} margin={{ top: 12, right: 16, bottom: 4, left: 0 }} barCategoryGap="30%">
                <CartesianGrid stroke={C.grid} vertical={false} />
                <XAxis dataKey="label" tick={{ fill: C.muted, fontSize: 11 }} axisLine={{ stroke: C.axis }} tickLine={false} />
                <YAxis
                  tickFormatter={(v: number) => compactMoney(v)}
                  tick={{ fill: C.muted, fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  width={60}
                />
                <Tooltip content={<WeekTip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                <Bar dataKey="grossProfit" name="Gross profit" fill={C.profit} radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Margin by week" subtitle="Gross profit as a share of covered revenue">
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={weekly} margin={{ top: 12, right: 16, bottom: 4, left: 0 }}>
                <CartesianGrid stroke={C.grid} vertical={false} />
                <XAxis dataKey="label" tick={{ fill: C.muted, fontSize: 11 }} axisLine={{ stroke: C.axis }} tickLine={false} />
                <YAxis
                  tickFormatter={(v: number) => pct(v, 0)}
                  tick={{ fill: C.muted, fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  width={44}
                  domain={[0, (max: number) => Math.max(0.3, Math.ceil(max * 10) / 10)]}
                />
                <Tooltip content={<WeekTip />} cursor={{ stroke: C.axis }} />
                <Line
                  type="monotone"
                  dataKey="marginPct"
                  name="Margin"
                  stroke={C.profit}
                  strokeWidth={2}
                  connectNulls
                  dot={{ r: 4, fill: C.profit, stroke: C.surface, strokeWidth: 2 }}
                  activeDot={{ r: 5, stroke: C.surface, strokeWidth: 2 }}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Loads by week" subtitle="Everything that picked up, covered or not">
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={weekly} margin={{ top: 12, right: 16, bottom: 4, left: 0 }} barCategoryGap="30%">
                <CartesianGrid stroke={C.grid} vertical={false} />
                <XAxis dataKey="label" tick={{ fill: C.muted, fontSize: 11 }} axisLine={{ stroke: C.axis }} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fill: C.muted, fontSize: 11 }} axisLine={false} tickLine={false} width={32} />
                <Tooltip content={<WeekTip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                <Bar dataKey="loads" name="Loads" fill={C.revenue} radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>

        {showTable && (
          <div className="card mb-4 overflow-x-auto">
            <table className="w-full border-collapse">
              <thead className="border-b border-ink-700 bg-ink-850">
                <tr>
                  <th className="th">Week of</th>
                  <th className="th text-right">Loads</th>
                  <th className="th text-right">Revenue</th>
                  <th className="th text-right">Carrier cost</th>
                  <th className="th text-right">Gross profit</th>
                  <th className="th text-right">Margin</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {weekly.map((w) => (
                  <tr key={w.week} className="border-b border-ink-800">
                    <td className="td">{w.label}</td>
                    <td className="td text-right">{w.loads}</td>
                    <td className="td text-right">{money(w.revenue)}</td>
                    <td className="td text-right">{money(w.carrierCost)}</td>
                    <td className="td text-right">{money(w.grossProfit)}</td>
                    <td className="td text-right">{pct(w.marginPct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ----------------------------------------------------- tables */}
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="card overflow-hidden">
            <div className="border-b border-ink-700 px-3 py-2 text-sm font-semibold text-slate-200">
              Top customers by revenue
            </div>
            <table className="w-full border-collapse">
              <thead className="bg-ink-850">
                <tr>
                  <th className="th">Customer</th>
                  <th className="th text-right">Loads</th>
                  <th className="th w-1/3">Revenue</th>
                  <th className="th text-right">Margin</th>
                </tr>
              </thead>
              <tbody>
                {customers.length === 0 && (
                  <tr>
                    <td className="td text-slate-500" colSpan={4}>
                      Nothing yet.
                    </td>
                  </tr>
                )}
                {customers.map((c) => {
                  const max = customers[0]?.revenue || 1
                  return (
                    <tr key={c.customer_id ?? c.name} className="border-b border-ink-800">
                      <td className="td">
                        {c.customer_id ? (
                          <Link to={`/customers/${c.customer_id}`} className="text-accent hover:underline">
                            {c.name}
                          </Link>
                        ) : (
                          <span className="text-slate-400">{c.name}</span>
                        )}
                      </td>
                      <td className="td text-right tabular-nums">{c.loads}</td>
                      <td className="td">
                        <div className="flex items-center gap-2">
                          <div className="h-2 flex-1 rounded-sm bg-ink-800">
                            <div
                              className="h-2 rounded-sm"
                              style={{ width: `${Math.max(2, (c.revenue / max) * 100)}%`, background: C.revenue }}
                            />
                          </div>
                          <span className="w-16 text-right text-xs tabular-nums text-slate-300">{compactMoney(c.revenue)}</span>
                        </div>
                      </td>
                      <td className="td text-right tabular-nums">{pct(c.marginPct)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </section>

          <section className="card overflow-hidden">
            <div className="border-b border-ink-700 px-3 py-2 text-sm font-semibold text-slate-200">
              Top lanes by volume
            </div>
            <table className="w-full border-collapse">
              <thead className="bg-ink-850">
                <tr>
                  <th className="th">Lane</th>
                  <th className="th text-right">Loads</th>
                  <th className="th text-right">Revenue</th>
                  <th className="th text-right">$/mile</th>
                </tr>
              </thead>
              <tbody>
                {lanes.length === 0 && (
                  <tr>
                    <td className="td text-slate-500" colSpan={4}>
                      Nothing yet.
                    </td>
                  </tr>
                )}
                {lanes.map((l) => (
                  <tr key={l.lane} className="border-b border-ink-800">
                    <td className="td text-sm">{l.lane}</td>
                    <td className="td text-right tabular-nums">{l.loads}</td>
                    <td className="td text-right tabular-nums">{compactMoney(l.revenue)}</td>
                    <td className="td text-right tabular-nums">
                      {l.avgRevenuePerMile !== null ? `$${l.avgRevenuePerMile.toFixed(2)}` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      </div>
    </div>
  )
}

function money(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

/** Stat tile: label, value (proportional figures), one line of context. */
function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card p-3">
      <div className="text-xs text-slate-400">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-slate-100">{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-slate-500">{sub}</div>}
    </div>
  )
}

function RunwayTile({
  runway,
  monthlyGrossProfit,
}: {
  runway: ReturnType<typeof summarize>['runway']
  monthlyGrossProfit: number
}) {
  if (runway.status === 'unknown') {
    return (
      <div className="card p-3">
        <div className="text-xs text-slate-400">Runway</div>
        <div className="mt-1 text-2xl font-semibold text-slate-500">—</div>
        <div className="mt-0.5 text-[11px] text-slate-500">
          Set cash on hand and monthly overhead in{' '}
          <Link to="/settings" className="text-accent hover:underline">
            Settings
          </Link>
        </div>
      </div>
    )
  }
  if (runway.status === 'profitable') {
    return (
      <div className="card border-band-green/40 p-3">
        <div className="text-xs text-slate-400">Runway</div>
        <div className="mt-1 text-2xl font-semibold text-emerald-300">Profitable</div>
        <div className="mt-0.5 text-[11px] text-slate-500">
          {compactMoney(monthlyGrossProfit)}/mo gross profit covers overhead
        </div>
      </div>
    )
  }
  const months = runway.months ?? 0
  const tone = months < 3 ? 'text-red-300' : months < 6 ? 'text-amber-300' : 'text-slate-100'
  return (
    <div className="card p-3">
      <div className="text-xs text-slate-400">Runway</div>
      <div className={`mt-1 text-2xl font-semibold ${tone}`}>{months.toFixed(1)} mo</div>
      <div className="mt-0.5 text-[11px] text-slate-500">
        burning {compactMoney(runway.monthlyNetBurn)}/mo after gross profit
      </div>
    </div>
  )
}

function ChartCard({
  title,
  subtitle,
  legend,
  children,
}: {
  title: string
  subtitle?: string
  legend?: Array<{ label: string; color: string }>
  children: React.ReactNode
}) {
  return (
    <section className="card p-3">
      <div className="mb-2 flex flex-wrap items-baseline gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-200">{title}</h2>
          {subtitle && <div className="text-xs text-slate-500">{subtitle}</div>}
        </div>
        {/* Legend text stays in ink; the swatch carries the colour. */}
        {legend && (
          <div className="ml-auto flex items-center gap-3 text-xs text-slate-300">
            {legend.map((l) => (
              <span key={l.label} className="inline-flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: l.color }} />
                {l.label}
              </span>
            ))}
          </div>
        )}
      </div>
      {children}
    </section>
  )
}

/** One tooltip for every weekly chart, so hovering anywhere tells the same story. */
function WeekTip({ active, payload }: { active?: boolean; payload?: Array<{ payload: WeekPoint }> }) {
  if (!active || !payload?.length) return null
  const w = payload[0].payload
  return (
    <div className="rounded border border-ink-600 bg-ink-850 p-2 text-xs shadow-lg">
      <div className="mb-1 font-medium text-slate-200">Week of {w.label}</div>
      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 tabular-nums text-slate-300">
        <span className="text-slate-500">Loads</span>
        <span className="text-right">{w.loads}</span>
        <span className="inline-flex items-center gap-1 text-slate-500">
          <i className="inline-block h-2 w-2 rounded-full" style={{ background: C.revenue }} />
          Revenue
        </span>
        <span className="text-right">{money(w.revenue)}</span>
        <span className="inline-flex items-center gap-1 text-slate-500">
          <i className="inline-block h-2 w-2 rounded-full" style={{ background: C.cost }} />
          Carrier cost
        </span>
        <span className="text-right">{money(w.carrierCost)}</span>
        <span className="inline-flex items-center gap-1 text-slate-500">
          <i className="inline-block h-2 w-2 rounded-full" style={{ background: C.profit }} />
          Gross profit
        </span>
        <span className="text-right">{money(w.grossProfit)}</span>
        <span className="text-slate-500">Margin</span>
        <span className="text-right">{pct(w.marginPct)}</span>
      </div>
    </div>
  )
}
