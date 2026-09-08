import { Link } from 'react-router-dom'
import { useLaneCarriers, type LaneCarrierRow } from '@/hooks/useLaneCarriers'
import { BAND_CLASS, BAND_DOT_CLASS, type Band } from '@/lib/qc-bands'
import { relativeTime } from '@/lib/urgency'

/**
 * Mirrors the thresholds on the carrier scorecard so a carrier does not read
 * as green here and orange one screen over.
 *
 * Unlike the scorecard this list cannot suppress a thin sample: the RPC
 * returns the percentage without the count of loads it stands on, so the dot
 * is a hint to open the carrier, not a verdict.
 */
const ON_TIME_GREEN_PCT = 95
const ON_TIME_YELLOW_PCT = 90
const ON_TIME_ORANGE_PCT = 80

function onTimeBand(pct: number): Band {
  if (pct >= ON_TIME_GREEN_PCT) return 'green'
  if (pct >= ON_TIME_YELLOW_PCT) return 'yellow'
  if (pct >= ON_TIME_ORANGE_PCT) return 'orange'
  return 'red'
}

function finiteOrNull(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function formatRatePerMile(value: number | null | undefined): string | null {
  const n = finiteOrNull(value)
  return n === null ? null : `$${n.toFixed(2)}/mi`
}

/**
 * `last_hauled_at` falls back to the scheduled dates when a load has not
 * delivered, so it can sit in the future — "ran in 2d" would be nonsense.
 */
function hauledLabel(iso: string | null): string {
  const t = iso ? new Date(iso).getTime() : NaN
  if (Number.isNaN(t)) return 'no dates on record'
  return t > Date.now() ? `on one now, runs ${relativeTime(iso)}` : `ran ${relativeTime(iso)}`
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

/**
 * "Have they run this lane?" — the half of the booking decision that is about
 * the lane rather than the carrier.
 *
 * Only ever suggests carriers already in the desk with history out of this
 * pickup area, so an empty result is a real answer ("nobody") and has to send
 * the dispatcher to the full carrier list rather than leave them staring at an
 * empty box.
 */
export default function LaneCarrierPicker({
  originMetroId,
  destMetroId,
  onSelect,
  selectedCarrierId,
  originMetroName,
  destMetroName,
  saving,
  className = '',
}: {
  originMetroId: string | null | undefined
  destMetroId?: string | null
  onSelect: (carrierId: string) => void
  /** Marks the carrier already on the load so it is not offered as news. */
  selectedCarrierId?: string | null
  originMetroName?: string | null
  destMetroName?: string | null
  saving?: boolean
  className?: string
}) {
  const { data, isLoading, isError } = useLaneCarriers(originMetroId, destMetroId)

  const originLabel = originMetroName?.trim() || 'this metro'
  const rows = data ?? []
  const laneRows = rows.filter((r) => r.match_kind === 'lane')
  const metroRows = rows.filter((r) => r.match_kind !== 'lane')

  return (
    <section className={`card p-3 ${className}`} data-search-exclude>
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-200">Who has run this</h2>
        {rows.length > 0 && (
          <span className="text-xs text-slate-400">{plural(rows.length, 'carrier')}</span>
        )}
      </div>

      <p className="mb-2.5 text-[11px] leading-snug text-slate-500">
        Matched metro to metro, not city to city — a Marietta pickup surfaces Atlanta carriers.
      </p>

      {!originMetroId ? (
        <Notice>
          This load's pickup city hasn't been matched to a metro, so there's no lane to search on.
          Set the origin, or pick a carrier from the full list.
        </Notice>
      ) : isLoading ? (
        <p className="text-xs text-slate-500">Checking who has run out of {originLabel}…</p>
      ) : isError ? (
        <Notice>
          Couldn't load lane history. The full carrier list still works —{' '}
          <Link to="/carriers" className="text-accent hover:underline">
            browse carriers
          </Link>
          .
        </Notice>
      ) : rows.length === 0 ? (
        <Notice>
          Nobody in the desk has hauled out of {originLabel} yet. This only knows carriers you have
          already run, so search the{' '}
          <Link to="/carriers" className="text-accent hover:underline">
            full carrier list
          </Link>{' '}
          instead — a good carrier for this lane may simply be new to you.
        </Notice>
      ) : (
        <div className="space-y-3">
          {laneRows.length > 0 && (
            <Group
              title={
                destMetroName?.trim()
                  ? `Ran ${originLabel} → ${destMetroName.trim()}`
                  : 'Ran this exact lane'
              }
              subtitle="Both ends match."
              accent
              rows={laneRows}
              originLabel={originLabel}
              selectedCarrierId={selectedCarrierId}
              onSelect={onSelect}
              saving={saving}
            />
          )}

          {metroRows.length > 0 && (
            <Group
              title={`Ran out of ${originLabel}`}
              subtitle={
                destMetroId
                  ? 'They know the pickup area, but have not taken it to this destination.'
                  : 'No destination metro on this load yet, so this is pickup area only.'
              }
              rows={metroRows}
              originLabel={originLabel}
              selectedCarrierId={selectedCarrierId}
              onSelect={onSelect}
              saving={saving}
            />
          )}
        </div>
      )}
    </section>
  )
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-md border border-ink-700 bg-ink-950 p-2.5 text-xs leading-relaxed text-slate-400">
      {children}
    </p>
  )
}

/**
 * The exact-lane group is bordered in accent and always sits first: a
 * dispatcher scanning this list has to be able to tell at a glance which
 * carriers have actually done the run and which merely know the pickup area.
 */
function Group({
  title,
  subtitle,
  accent,
  rows,
  originLabel,
  selectedCarrierId,
  onSelect,
  saving,
}: {
  title: string
  subtitle: string
  accent?: boolean
  rows: LaneCarrierRow[]
  originLabel: string
  selectedCarrierId?: string | null
  onSelect: (carrierId: string) => void
  saving?: boolean
}) {
  return (
    <div
      className={`rounded-md border ${accent ? 'border-accent/40 bg-accent/5' : 'border-ink-700 bg-ink-950'}`}
    >
      <div className="flex flex-wrap items-baseline gap-x-2 border-b border-ink-700 px-2.5 py-1.5">
        <span
          className={`text-xs font-semibold uppercase tracking-wide ${accent ? 'text-accent' : 'text-slate-400'}`}
        >
          {title}
        </span>
        <span className="text-[11px] text-slate-500">
          {plural(rows.length, 'carrier')} · {subtitle}
        </span>
      </div>

      <ul className="divide-y divide-ink-800">
        {rows.map((row) => (
          <CarrierRow
            key={row.carrier_id}
            row={row}
            originLabel={originLabel}
            isSelected={row.carrier_id === selectedCarrierId}
            onSelect={onSelect}
            saving={saving}
          />
        ))}
      </ul>
    </div>
  )
}

function CarrierRow({
  row,
  originLabel,
  isSelected,
  onSelect,
  saving,
}: {
  row: LaneCarrierRow
  originLabel: string
  isSelected: boolean
  onSelect: (carrierId: string) => void
  saving?: boolean
}) {
  const laneLoads = Number(row.lane_loads) || 0
  const metroLoads = Number(row.origin_metro_loads) || 0
  const rpm = formatRatePerMile(row.avg_rate_per_mile)

  return (
    <li className="flex items-start gap-2 px-2.5 py-2">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <Link
            to={`/carriers/${row.carrier_id}`}
            className="truncate text-sm font-medium text-slate-100 hover:text-accent hover:underline"
          >
            {row.carrier_name}
          </Link>
          {row.dot_number && (
            <span className="text-[11px] text-slate-500">DOT {row.dot_number}</span>
          )}
          {row.status === 'inactive' && (
            <span className="rounded border border-band-orange/40 px-1 py-px text-[10px] font-semibold text-band-orange">
              inactive
            </span>
          )}
          <OnTime pct={row.on_time_delivery_pct} />
        </div>

        <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-[11px] text-slate-500">
          {laneLoads > 0 && (
            <span className="font-medium text-slate-300">
              {plural(laneLoads, 'load')} on this lane
            </span>
          )}
          <span>
            {plural(metroLoads, 'load')} out of {originLabel}
          </span>
          {rpm && (
            <span title={`Average rate per mile on their loads out of ${originLabel}`}>{rpm}</span>
          )}
          <span>{hauledLabel(row.last_hauled_at)}</span>
        </div>
      </div>

      {isSelected ? (
        <span className="shrink-0 self-center text-xs text-slate-500">on this load</span>
      ) : (
        <button
          className="btn btn-primary shrink-0 self-center text-xs"
          onClick={() => onSelect(row.carrier_id)}
          disabled={saving}
        >
          Use
        </button>
      )}
    </li>
  )
}

/**
 * A null percentage means nobody has logged an arrival for this carrier yet.
 * Rendering that as 0% would read as "never on time" and cost them the load.
 */
function OnTime({ pct }: { pct: number | null | undefined }) {
  const value = finiteOrNull(pct)

  if (value === null) {
    return (
      <span
        title="No arrival has been logged on any of their loads, so there is no on-time record either way."
        className="text-[11px] text-slate-500"
      >
        on-time not measured
      </span>
    )
  }

  const band = onTimeBand(value)
  return (
    <span
      title="On-time delivery across all their loads, not just this lane. Open the carrier for the loads behind it."
      className={`inline-flex items-center gap-1 rounded border px-1 py-px text-[10px] font-semibold ${BAND_CLASS[band]}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${BAND_DOT_CLASS[band]}`} />
      {Math.round(value)}% on time
    </span>
  )
}
