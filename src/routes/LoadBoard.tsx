import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLoadBoard } from '@/hooks/useLoads'
import { usePipelineStages, useSettings } from '@/hooks/useSettings'
import { useAuth } from '@/hooks/useAuth'
import { useSaveMyPreferences } from '@/hooks/useProfiles'
import { urgencyFor, relativeTime, type UrgencyResult } from '@/lib/urgency'
import { BAND_DOT_CLASS, BAND_SEVERITY, bandFor } from '@/lib/qc-bands'
import { BandDot, BandPill } from '@/components/BandPill'
import Toggle from '@/components/Toggle'
import type { LoadBoardRow } from '@/types/db'

type SortKey = 'urgency' | 'pickup' | 'qc' | 'load_number'

export default function LoadBoard() {
  const [search, setSearch] = useState('')
  const [stageKeys, setStageKeys] = useState<string[]>([])
  const [includeTerminal, setIncludeTerminal] = useState(false)
  const [sort, setSort] = useState<SortKey>('urgency')

  const { data: settings } = useSettings()
  const { data: stages } = usePipelineStages()
  const { view, flagRules, can, profile } = useAuth()
  const savePrefs = useSaveMyPreferences()
  const { data: rows, isLoading, error } = useLoadBoard({ search, stageKeys, includeTerminal })

  // Flags are computed client-side against "now" so colours stay correct as
  // time passes without needing the server to re-evaluate every row. The
  // rules used are the org's, narrowed by this viewer's team and own switches.
  const decorated = useMemo(() => {
    const now = new Date()
    const visible = (rows ?? []).filter((row) =>
      row.stage_is_booked ? view.show_booked : view.show_unbooked,
    )
    const list = visible.map((row) => ({
      row,
      urgency: urgencyFor(
        {
          isBooked: row.stage_is_booked,
          firstPickupAt: row.first_pickup_at,
          hasTrackingEvent: row.has_tracking_event,
          lastTouchedAt: row.last_touched_at,
          isTerminal: row.stage_is_terminal,
          phase: row.stage_phase,
        },
        flagRules,
        now,
      ),
    }))

    const sorted = [...list]
    if (sort === 'urgency') {
      sorted.sort((a, b) => {
        const sev = BAND_SEVERITY[b.urgency.band] - BAND_SEVERITY[a.urgency.band]
        if (sev !== 0) return sev
        return (a.urgency.hoursToPickup ?? 1e9) - (b.urgency.hoursToPickup ?? 1e9)
      })
    } else if (sort === 'pickup') {
      sorted.sort((a, b) => (a.urgency.hoursToPickup ?? 1e9) - (b.urgency.hoursToPickup ?? 1e9))
    } else if (sort === 'qc') {
      sorted.sort((a, b) => (a.row.qc_score ?? 1) - (b.row.qc_score ?? 1))
    } else {
      sorted.sort((a, b) => a.row.load_number.localeCompare(b.row.load_number))
    }
    return sorted
  }, [rows, flagRules, view.show_booked, view.show_unbooked, sort])

  const hiddenCount = (rows?.length ?? 0) - decorated.length

  const counts = useMemo(() => {
    const c = { red: 0, orange: 0, yellow: 0, green: 0, none: 0 }
    decorated.forEach((d) => {
      c[d.urgency.band] += 1
    })
    return c
  }, [decorated])

  function toggleStage(key: string) {
    setStageKeys((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]))
  }

  function setView(patch: { show_unbooked?: boolean; show_booked?: boolean }) {
    const own = profile?.preferences ?? {}
    const next = { ...own, ...patch }
    // Keep the flag master switch in step with the visibility switch — hiding
    // a board and still flagging it would be a colour count for nothing.
    next.flags = {
      ...own.flags,
      ...(patch.show_unbooked !== undefined
        ? { unbooked: { ...own.flags?.unbooked, enabled: patch.show_unbooked } }
        : {}),
      ...(patch.show_booked !== undefined
        ? { booked: { ...own.flags?.booked, enabled: patch.show_booked } }
        : {}),
    }
    savePrefs.mutate(next)
  }

  return (
    <div className="p-4">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold text-slate-100">Load board</h1>

        <div className="flex items-center gap-2 text-xs">
          {(['red', 'orange', 'yellow', 'green'] as const).map((b) => (
            <span key={b} className="inline-flex items-center gap-1 text-slate-400">
              <span className={`h-2 w-2 rounded-full ${BAND_DOT_CLASS[b]}`} />
              {counts[b]}
            </span>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <input
            className="input w-72"
            placeholder="Search load #, customer, carrier, DOT, city…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            className="input w-36"
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
          >
            <option value="urgency">Sort: flags</option>
            <option value="pickup">Sort: pickup</option>
            <option value="qc">Sort: QC score</option>
            <option value="load_number">Sort: load #</option>
          </select>
          {can('create_loads') && (
            <Link to="/loads/new" className="btn btn-primary">
              + New load
            </Link>
          )}
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {(stages ?? []).map((stage) => {
          const on = stageKeys.includes(stage.key)
          return (
            <button
              key={stage.id}
              onClick={() => toggleStage(stage.key)}
              className={`rounded-full border px-2.5 py-1 text-xs font-medium transition ${
                on
                  ? 'border-accent/50 bg-accent/15 text-accent'
                  : 'border-ink-600 bg-ink-800 text-slate-300 hover:bg-ink-700'
              }`}
            >
              {stage.label}
            </button>
          )
        })}
        {(stageKeys.length > 0 || search) && (
          <button
            className="ml-1 text-xs text-slate-400 underline hover:text-slate-200"
            onClick={() => {
              setStageKeys([])
              setSearch('')
            }}
          >
            Clear filters
          </button>
        )}

        {/* --------------------------------------------- my view switches */}
        <div className="ml-auto flex flex-wrap items-center gap-4 text-xs text-slate-400">
          <span className="font-medium uppercase tracking-wide text-slate-500">View</span>
          <Toggle
            size="sm"
            checked={view.show_unbooked}
            onChange={(v) => setView({ show_unbooked: v })}
            label={<span className="text-xs font-normal text-slate-300">Unbooked</span>}
          />
          <Toggle
            size="sm"
            checked={view.show_booked}
            onChange={(v) => setView({ show_booked: v })}
            label={<span className="text-xs font-normal text-slate-300">Booked</span>}
          />
          <Toggle
            size="sm"
            tone="accent"
            checked={includeTerminal}
            onChange={setIncludeTerminal}
            label={<span className="text-xs font-normal text-slate-300">Closed</span>}
          />
        </div>
      </div>

      {hiddenCount > 0 && (
        <div className="mb-2 text-xs text-slate-500">
          {hiddenCount} load{hiddenCount === 1 ? '' : 's'} hidden by your view switches.
        </div>
      )}

      {error && (
        <div className="card border-band-red/40 bg-band-red/10 p-3 text-sm text-red-300">
          Couldn&apos;t load the board: {(error as Error).message}
        </div>
      )}

      <div className="card overflow-hidden">
        <table className="w-full border-collapse">
          <thead className="border-b border-ink-700 bg-ink-850">
            <tr>
              <th className="th w-8" />
              <th className="th">Load</th>
              <th className="th">Stage</th>
              <th className="th">Customer</th>
              <th className="th">Lane</th>
              <th className="th">Pickup</th>
              <th className="th">Carrier</th>
              <th className="th">Rate</th>
              <th className="th">QC</th>
              <th className="th">Waiting</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td className="td text-slate-400" colSpan={10}>
                  Loading…
                </td>
              </tr>
            )}
            {!isLoading && decorated.length === 0 && (
              <tr>
                <td className="td text-slate-400" colSpan={10}>
                  {hiddenCount > 0
                    ? 'Every load is hidden by your view switches.'
                    : can('create_loads')
                      ? 'No loads yet. Add one with New load, or drop a tender into the connector.'
                      : 'No loads match.'}
                </td>
              </tr>
            )}
            {decorated.map(({ row, urgency }) => (
              <BoardRow key={row.id} row={row} urgency={urgency} qcBands={settings?.qcBands} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function money(n: number | null): string {
  if (n === null || n === undefined) return '—'
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

function BoardRow({
  row,
  urgency,
  qcBands,
}: {
  row: LoadBoardRow
  urgency: UrgencyResult
  qcBands?: Parameters<typeof bandFor>[1]
}) {
  const qcBand = bandFor(row.qc_score, qcBands)
  return (
    <tr className="border-b border-ink-800 transition hover:bg-ink-850">
      <td className="td">
        <BandDot band={urgency.band} title={urgency.reason} />
      </td>
      <td className="td">
        <Link to={`/loads/${row.id}`} className="font-medium text-accent hover:underline">
          {row.load_number}
        </Link>
        {row.is_test && (
          <span
            className="ml-1.5 rounded bg-fuchsia-500/15 px-1 text-[10px] font-semibold uppercase text-fuchsia-300"
            title="A test load — left out of reports"
          >
            test
          </span>
        )}
        {row.shipment_id && <div className="text-xs text-slate-500">{row.shipment_id}</div>}
      </td>
      <td className="td">
        <span className="rounded bg-ink-800 px-1.5 py-0.5 text-xs text-slate-300">
          {row.stage_label}
        </span>
      </td>
      <td className="td">{row.customer_name ?? <span className="text-slate-500">—</span>}</td>
      <td className="td text-sm">
        {row.origin_city ? (
          <span>
            {row.origin_city}, {row.origin_state} → {row.dest_city}, {row.dest_state}
          </span>
        ) : (
          <span className="text-slate-500">—</span>
        )}
      </td>
      <td className="td" title={urgency.reason}>
        <div className="text-sm">{relativeTime(row.first_pickup_at)}</div>
        <div className="text-xs text-slate-500">{urgency.reason}</div>
      </td>
      <td className="td">
        {row.carrier_name ? (
          <div>
            <div className="text-sm">{row.carrier_name}</div>
            {row.carrier_dot_number && (
              <div className="text-xs text-slate-500">DOT {row.carrier_dot_number}</div>
            )}
          </div>
        ) : (
          <span className="text-xs text-slate-500">unassigned</span>
        )}
      </td>
      <td className="td">
        <div className="text-sm">{money(row.customer_rate)}</div>
        {row.carrier_rate !== null && (
          <div className="text-xs text-slate-500">
            {money(row.carrier_rate)} · {money(row.margin)}
          </div>
        )}
      </td>
      <td className="td">
        {row.source === 'manual' ? (
          <span className="text-xs text-slate-500" title="Typed in by hand — nothing to QC">
            manual
          </span>
        ) : (
          <>
            <BandPill confidence={row.qc_score} thresholds={qcBands} />
            {qcBand === 'red' && <div className="text-[10px] text-red-300">needs review</div>}
          </>
        )}
      </td>
      <td className="td">
        {row.open_flag_count > 0 ? (
          <span className="rounded-full border border-band-yellow/40 bg-band-yellow/15 px-2 py-0.5 text-xs text-amber-300">
            {row.open_flag_count} waiting
          </span>
        ) : (
          <span className="text-xs text-slate-500">—</span>
        )}
      </td>
    </tr>
  )
}
