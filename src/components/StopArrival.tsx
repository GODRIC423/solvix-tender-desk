import { useState } from 'react'
import { BAND_CLASS, BAND_DOT_CLASS } from '@/lib/qc-bands'
import {
  DEFAULT_ON_TIME_GRACE_MINUTES,
  formatInZone,
  formatMinutes,
  fromDateTimeLocal,
  latenessFor,
  resolveStopZone,
  toDateTimeLocal,
  useOnTimeGrace,
  useStopActuals,
  type StopActualField,
} from '@/hooks/useStopActuals'
import type { LoadStop } from '@/types/db'

/**
 * Logging when the truck actually showed up.
 *
 * Nothing else in the app writes `load_stops.actual_arrival`, so until a
 * dispatcher fills these in, every on-time percentage the desk reports is
 * permanently null. The one-click buttons exist because this is entered while
 * somebody is still on the phone; the time field exists because it is just as
 * often entered an hour later, from a driver's text.
 */
export default function StopArrival({ stop, loadId }: { stop: LoadStop; loadId: string }) {
  const { set, clear } = useStopActuals(loadId)
  const { data: graceMinutes } = useOnTimeGrace()
  const { zone, dockLocal } = resolveStopZone(stop)

  const saving = set.isPending || clear.isPending
  const error = (set.error ?? clear.error) as Error | null

  const dwellMinutes =
    stop.actual_arrival && stop.actual_departure
      ? (new Date(stop.actual_departure).getTime() - new Date(stop.actual_arrival).getTime()) /
        60_000
      : null

  return (
    <div className="mt-2 rounded border border-ink-700 bg-ink-900 p-2" data-search-exclude>
      <div className="mb-1.5 flex flex-wrap items-baseline gap-x-2">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-400">Actuals</span>
        <span className="text-[11px] text-slate-500" title={zone}>
          {dockLocal
            ? 'shown and entered in dock local time'
            : 'no dock timezone on this stop — shown and entered in your local time'}
        </span>
      </div>

      <div className="space-y-1.5">
        <ActualRow
          stop={stop}
          field="actual_arrival"
          label="Arrived"
          zone={zone}
          graceMinutes={graceMinutes ?? DEFAULT_ON_TIME_GRACE_MINUTES}
          saving={saving}
          onSet={(at) => set.mutate({ stop, field: 'actual_arrival', at })}
          onClear={() => clear.mutate({ stop, field: 'actual_arrival' })}
        />
        <ActualRow
          stop={stop}
          field="actual_departure"
          label="Departed"
          zone={zone}
          graceMinutes={graceMinutes ?? DEFAULT_ON_TIME_GRACE_MINUTES}
          saving={saving}
          onSet={(at) => set.mutate({ stop, field: 'actual_departure', at })}
          onClear={() => clear.mutate({ stop, field: 'actual_departure' })}
        />
      </div>

      {dwellMinutes !== null &&
        (dwellMinutes < 0 ? (
          <p className="mt-1.5 text-[11px] text-red-300">
            Departure is before arrival — one of these is wrong.
          </p>
        ) : (
          <p className="mt-1.5 text-[11px] text-slate-500">
            On site {formatMinutes(dwellMinutes)}.
          </p>
        ))}

      {error && <p className="mt-1.5 text-[11px] text-red-300">{error.message}</p>}
    </div>
  )
}

function ActualRow({
  stop,
  field,
  label,
  zone,
  graceMinutes,
  saving,
  onSet,
  onClear,
}: {
  stop: LoadStop
  field: StopActualField
  label: string
  zone: string
  graceMinutes: number
  saving: boolean
  onSet: (at?: string) => void
  onClear: () => void
}) {
  const [draft, setDraft] = useState<string | null>(null)

  const value = field === 'actual_arrival' ? stop.actual_arrival : stop.actual_departure
  // Only arrival is measured against a commitment; nothing promises a departure.
  const late = field === 'actual_arrival' ? latenessFor(value, stop, graceMinutes) : null

  const openEditor = () => setDraft(toDateTimeLocal(value ?? new Date().toISOString(), zone))

  const commitDraft = () => {
    if (!draft) return
    const iso = fromDateTimeLocal(draft, zone)
    if (!iso) return
    onSet(iso)
    setDraft(null)
  }

  if (draft !== null) {
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="w-16 shrink-0 text-xs text-slate-400">{label}</span>
        <input
          className="input w-auto text-xs"
          type="datetime-local"
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitDraft()
            if (e.key === 'Escape') setDraft(null)
          }}
        />
        <button className="btn btn-primary text-xs" disabled={saving || !draft} onClick={commitDraft}>
          Save
        </button>
        <button className="btn text-xs" onClick={() => setDraft(null)}>
          Cancel
        </button>
      </div>
    )
  }

  if (!value) {
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="w-16 shrink-0 text-xs text-slate-400">{label}</span>
        <span className="text-sm text-slate-500">not logged</span>
        <button
          className="btn btn-primary ml-auto text-xs"
          disabled={saving}
          onClick={() => onSet()}
        >
          {label} now
        </button>
        <button className="btn text-xs" disabled={saving} onClick={openEditor}>
          At a time…
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="w-16 shrink-0 text-xs text-slate-400">{label}</span>
      <span className="text-sm text-slate-200">{formatInZone(value, zone)}</span>
      {late && (
        <span
          className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${BAND_CLASS[late.band]}`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${BAND_DOT_CLASS[late.band]}`} />
          {late.label}
        </span>
      )}
      <button className="btn ml-auto text-xs" disabled={saving} onClick={openEditor}>
        Change
      </button>
      <button
        className="btn text-xs"
        disabled={saving}
        title={`Clear the ${label.toLowerCase()} time`}
        onClick={onClear}
      >
        Clear
      </button>
    </div>
  )
}
