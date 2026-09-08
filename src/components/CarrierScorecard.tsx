import { useCarrierPerformance, type CarrierPerformanceRow } from '@/hooks/useCarrierPerformance'
import { BAND_CLASS, BAND_DOT_CLASS, type Band } from '@/lib/qc-bands'
import { relativeTime } from '@/lib/urgency'

/**
 * Service thresholds, in whole percent. A desk holds a carrier to a tighter
 * standard than QC holds an extracted field, so these are their own numbers —
 * but they land on the same four colours everything else in the app uses.
 */
const ON_TIME_GREEN_PCT = 95
const ON_TIME_YELLOW_PCT = 90
const ON_TIME_ORANGE_PCT = 80

/**
 * Below this many rated loads a percentage is arithmetic, not a record: one
 * late pickup out of two reads as 50%, and painting that red would condemn a
 * carrier over a single bad morning. Shown, but left uncoloured.
 */
const MIN_RATED_LOADS_FOR_BAND = 5

function onTimeBand(pct: number | null, ratedCount: number): Band {
  if (pct === null || ratedCount < MIN_RATED_LOADS_FOR_BAND) return 'none'
  if (pct >= ON_TIME_GREEN_PCT) return 'green'
  if (pct >= ON_TIME_YELLOW_PCT) return 'yellow'
  if (pct >= ON_TIME_ORANGE_PCT) return 'orange'
  return 'red'
}

function formatPct(pct: number): string {
  return `${Math.round(pct)}%`
}

function formatRatePerMile(value: number | null): string {
  const n = Number(value)
  if (value === null || !Number.isFinite(n)) return '—'
  return `$${n.toFixed(2)}`
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

/**
 * "Are they any good?" — the half of the booking decision that is about the
 * carrier rather than the lane.
 */
export default function CarrierScorecard({
  carrierId,
  className = '',
}: {
  carrierId: string
  className?: string
}) {
  const { data, isLoading, isError } = useCarrierPerformance(carrierId)

  if (isLoading) {
    return (
      <Shell className={className}>
        <p className="text-xs text-slate-500">Loading scorecard…</p>
      </Shell>
    )
  }

  if (isError || !data) {
    return (
      <Shell className={className}>
        <p className="text-xs text-slate-500">No performance record for this carrier.</p>
      </Shell>
    )
  }

  const loadsTotal = Number(data.loads_total) || 0

  return (
    <Shell
      className={className}
      right={
        <span className="text-xs text-slate-400">
          {plural(loadsTotal, 'load')} · {Number(data.loads_delivered) || 0} delivered
          {data.last_delivered_at && ` · last ${relativeTime(data.last_delivered_at)}`}
        </span>
      }
    >
      <div className="space-y-3">
        {loadsTotal === 0 ? (
          <p className="rounded-md border border-ink-700 bg-ink-950 p-2.5 text-xs text-slate-500">
            Nothing hauled yet — no on-time record and no rate history to go on.
          </p>
        ) : (
          <>
            <div className="grid gap-2 sm:grid-cols-2">
              <OnTimeTile
                label="On-time pickup"
                pct={data.on_time_pickup_pct}
                ratedCount={Number(data.pickup_rated_count) || 0}
                loadsTotal={loadsTotal}
              />
              <OnTimeTile
                label="On-time delivery"
                pct={data.on_time_delivery_pct}
                ratedCount={Number(data.delivery_rated_count) || 0}
                loadsTotal={loadsTotal}
              />
            </div>

            <RatePerMile row={data} />
          </>
        )}

        <BehaviourCounts row={data} />
      </div>
    </Shell>
  )
}

function Shell({
  className = '',
  right,
  children,
}: {
  className?: string
  right?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className={`card p-3 ${className}`}>
      <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-200">Scorecard</h2>
        {right}
      </div>
      {children}
    </section>
  )
}

function OnTimeTile({
  label,
  pct,
  ratedCount,
  loadsTotal,
}: {
  label: string
  pct: number | null | undefined
  ratedCount: number
  loadsTotal: number
}) {
  const value =
    pct === null || pct === undefined || !Number.isFinite(Number(pct)) ? null : Number(pct)
  const band = onTimeBand(value, ratedCount)
  const thin = ratedCount > 0 && ratedCount < MIN_RATED_LOADS_FOR_BAND

  return (
    <div className="rounded-md border border-ink-700 bg-ink-950 p-2.5">
      <div className="label">{label}</div>

      {value === null ? (
        <>
          <div className="text-sm font-medium text-slate-400">No arrivals logged yet</div>
          <p className="mt-1 text-[11px] text-slate-500">
            Not scored either way — this stays blank until someone records an actual arrival on one
            of their loads.
          </p>
        </>
      ) : (
        <>
          <span
            className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-lg font-semibold ${BAND_CLASS[band]}`}
          >
            <span className={`h-2 w-2 rounded-full ${BAND_DOT_CLASS[band]}`} />
            {formatPct(value)}
          </span>
          <p className="mt-1.5 text-[11px] text-slate-500">
            {plural(ratedCount, 'load')} of {loadsTotal} with a logged arrival
            {thin && ' — too few to judge them on'}
          </p>
        </>
      )}
    </div>
  )
}

function RatePerMile({ row }: { row: CarrierPerformanceRow }) {
  return (
    <div className="rounded-md border border-ink-700 bg-ink-950 p-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-400">
          Average rate / mile
        </span>
        <span className="text-lg font-semibold text-slate-100">
          {formatRatePerMile(row.avg_rate_per_mile)}
        </span>
      </div>

      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <DirectionRate
          label="Eastbound"
          rpm={row.avg_rate_per_mile_eastbound}
          loads={Number(row.eastbound_loads) || 0}
        />
        <DirectionRate
          label="Westbound"
          rpm={row.avg_rate_per_mile_westbound}
          loads={Number(row.westbound_loads) || 0}
        />
      </div>
      <p className="mt-1.5 text-[11px] text-slate-500">
        Short hops count as regional and stay out of the split.
      </p>
    </div>
  )
}

function DirectionRate({
  label,
  rpm,
  loads,
}: {
  label: string
  rpm: number | null
  loads: number
}) {
  return (
    <div className="flex items-baseline justify-between gap-2 rounded border border-ink-700 px-2 py-1.5">
      <span className="text-xs text-slate-400">{label}</span>
      {loads === 0 ? (
        <span className="text-xs text-slate-500">none run</span>
      ) : (
        <span className="flex items-baseline gap-1.5">
          <span className="text-sm font-medium text-slate-100">{formatRatePerMile(rpm)}</span>
          <span className="text-[11px] text-slate-500">{plural(loads, 'load')}</span>
        </span>
      )}
    </div>
  )
}

/**
 * Counted from structured interaction types rather than parsed out of notes,
 * which is what makes them safe to put on a scorecard. Money asks and service
 * failures are deliberately different colours — a carrier who asks for quick
 * pay is an inconvenience, one who falls off loads is a problem.
 */
function BehaviourCounts({ row }: { row: CarrierPerformanceRow }) {
  const items: { label: string; count: number; tone: Band; title: string }[] = [
    {
      label: 'Quick pay asks',
      count: Number(row.quick_pay_requests) || 0,
      tone: 'yellow',
      title: 'Times they have asked to be paid early',
    },
    {
      label: 'Rate increase asks',
      count: Number(row.rate_increase_requests) || 0,
      tone: 'orange',
      title: 'Times they have come back for more money after booking',
    },
    {
      label: 'Service failures',
      count: Number(row.service_failures) || 0,
      tone: 'red',
      title: 'Missed appointments, damage, no-shows',
    },
    {
      label: 'Fell off loads',
      count: Number(row.fell_off_loads) || 0,
      tone: 'red',
      title: 'Loads they took and then dropped',
    },
  ]

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {items.map((item) => {
        const band: Band = item.count > 0 ? item.tone : 'none'
        return (
          <div
            key={item.label}
            title={item.title}
            className={`rounded-md border px-2 py-1.5 ${BAND_CLASS[band]}`}
          >
            <div className="text-lg font-semibold leading-none">{item.count}</div>
            <div className="mt-1 text-[11px] leading-tight opacity-80">{item.label}</div>
          </div>
        )
      })}
    </div>
  )
}
