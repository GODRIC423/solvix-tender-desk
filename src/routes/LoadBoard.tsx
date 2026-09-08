import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLoadBoard } from '@/hooks/useLoads'
import { usePipelineStages, useSettings } from '@/hooks/useSettings'
import { urgencyFor, relativeTime, type UrgencyResult } from '@/lib/urgency'
import { BAND_DOT_CLASS, BAND_SEVERITY, bandFor } from '@/lib/qc-bands'
import { BandDot, BandPill } from '@/components/BandPill'
import type { LoadBoardRow } from '@/types/db'

type SortKey = 'urgency' | 'pickup' | 'qc' | 'load_number'

export default function LoadBoard() {
  const [search, setSearch] = useState('')
  const [stageKeys, setStageKeys] = useState<string[]>([])
  const [includeTerminal, setIncludeTerminal] = useState(false)
  const [sort, setSort] = useState<SortKey>('urgency')

  const { data: settings } = useSettings()
  const { data: stages } = usePipelineStages()
  const { data: rows, isLoading, error } = useLoadBoard({ search, stageKeys, includeTerminal })

  // Urgency is computed client-side against "now" so colors stay correct as
  // time passes without needing the server to re-evaluate every row.
  const decorated = useMemo(() => {
    const now = new Date()
    const list = (rows ?? []).map((row) => ({
      row,
      urgency: urgencyFor(
        {
          isBooked: row.stage_is_booked,
          firstPickupAt: row.first_pickup_at,
          hasTrackingEvent: row.has_tracking_event,
          lastTouchedAt: row.last_touched_at,
          isTerminal: row.stage_is_terminal,
        },
        settings?.urgencyRules,
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
  }, [rows, settings?.urgencyRules, sort])

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
            <option value="urgency">Sort: urgency</option>
            <option value="pickup">Sort: pickup</option>
            <option value="qc">Sort: QC score</option>
            <option value="load_number">Sort: load #</option>
          </select>
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
        <label className="ml-2 inline-flex items-center gap-1.5 text-xs text-slate-400">
          <input
            type="checkbox"
            checked={includeTerminal}
            onChange={(e) => setIncludeTerminal(e.target.checked)}
          />
          Show closed
        </label>
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
      </div>

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
              <th className="th">QC</th>
              <th className="th">Flags</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td className="td text-slate-400" colSpan={9}>
                  Loading…
                </td>
              </tr>
            )}
            {!isLoading && decorated.length === 0 && (
              <tr>
                <td className="td text-slate-400" colSpan={9}>
                  No loads match. Drop a tender into the connector to create one.
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
        <BandPill confidence={row.qc_score} thresholds={qcBands} />
        {qcBand === 'red' && <div className="text-[10px] text-red-300">needs review</div>}
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
