import { useCallback, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  useAddTrackingEvent,
  useLoad,
  useLoadFlags,
  useSetLoadStage,
  useUpdateLoad,
  useUpdateStop,
} from '@/hooks/useLoads'
import { useFlagTypes, usePipelineStages, useSettings } from '@/hooks/useSettings'
import { useInPageSearch, useFindShortcut } from '@/hooks/useInPageSearch'
import { useCustomerLocations } from '@/hooks/useCustomers'
import { LOAD_FIELD_GROUPS, confidenceAt, fieldAt } from '@/lib/load-fields'
import { bandFor, BAND_SEVERITY } from '@/lib/qc-bands'
import { urgencyFor, relativeTime } from '@/lib/urgency'
import { BandDot, BandPill, QcScoreBadge } from '@/components/BandPill'
import AssignParties from '@/components/AssignParties'
import type { LoadStop } from '@/types/db'

export default function LoadDetail() {
  const { id } = useParams<{ id: string }>()
  const { data, isLoading, error } = useLoad(id)
  const { data: settings } = useSettings()
  const { data: stages } = usePipelineStages()
  const { data: flagTypes } = useFlagTypes()

  const updateLoad = useUpdateLoad(id!)
  const setStage = useSetLoadStage(id!)
  const addTracking = useAddTrackingEvent(id!)
  const flags = useLoadFlags(id!)

  const search = useInPageSearch([data?.load?.id, isLoading])
  const searchInputRef = useRef<HTMLInputElement>(null)
  useFindShortcut(useCallback(() => searchInputRef.current?.focus(), []))

  const stage = useMemo(
    () => stages?.find((s) => s.id === data?.load.pipeline_stage_id),
    [stages, data?.load.pipeline_stage_id],
  )

  const urgency = useMemo(() => {
    if (!data) return null
    return urgencyFor(
      {
        isBooked: stage?.is_booked ?? false,
        firstPickupAt: data.load.first_pickup_at,
        hasTrackingEvent: data.tracking.length > 0,
        lastTouchedAt: data.load.last_touched_at,
        isTerminal: stage?.is_terminal ?? false,
      },
      settings?.urgencyRules,
    )
  }, [data, stage, settings?.urgencyRules])

  /** Fields the parser was unsure about — the actual QC worklist. */
  const needsReview = useMemo(() => {
    if (!data?.load.raw_extraction) return []
    return LOAD_FIELD_GROUPS.flatMap((g) => g.fields)
      .map((f) => ({ field: f, c: confidenceAt(data.load.raw_extraction, f.path) }))
      .filter((x) => x.c !== null && bandFor(x.c, settings?.qcBands) !== 'green')
      .sort(
        (a, b) =>
          BAND_SEVERITY[bandFor(b.c, settings?.qcBands)] -
          BAND_SEVERITY[bandFor(a.c, settings?.qcBands)],
      )
  }, [data?.load.raw_extraction, settings?.qcBands])

  if (isLoading) return <div className="p-6 text-sm text-slate-400">Loading load…</div>
  if (error || !data)
    return (
      <div className="p-6 text-sm text-red-300">
        Couldn&apos;t open that load: {(error as Error)?.message ?? 'not found'}
      </div>
    )

  const { load } = data

  return (
    <div className="p-4">
      {/* ---------------------------------------------------------- header */}
      <div className="mb-4 flex flex-wrap items-center gap-3" data-search-exclude>
        <Link to="/loads" className="text-sm text-slate-400 hover:text-slate-200">
          ← Board
        </Link>
        <h1 className="text-lg font-semibold text-slate-100">{load.load_number}</h1>
        {urgency && <BandDot band={urgency.band} title={urgency.reason} />}
        <QcScoreBadge score={load.qc_score} thresholds={settings?.qcBands} />

        <select
          className="input w-48"
          value={load.pipeline_stage_id}
          onChange={(e) => setStage.mutate({ stageId: e.target.value })}
        >
          {(stages ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>

        <div className="ml-auto flex items-center gap-2">
          <input
            ref={searchInputRef}
            className="input w-64"
            placeholder="Find in this load (e.g. lumper)…"
            value={search.query}
            onChange={(e) => search.setQuery(e.target.value)}
            onKeyDown={search.onInputKeyDown}
          />
          {search.query && (
            <span className="text-xs text-slate-400">
              {search.hitCount === 0 ? 'no hits' : `${search.activeIndex + 1}/${search.hitCount}`}
              <button className="ml-2 underline" onClick={search.prev}>
                prev
              </button>
              <button className="ml-1 underline" onClick={search.next}>
                next
              </button>
            </span>
          )}
        </div>
      </div>

      {/* waiting-on flags + quick check call */}
      <div className="mb-4 flex flex-wrap items-center gap-2" data-search-exclude>
        {data.flags.map((f) => {
          const t = flagTypes?.find((ft) => ft.id === f.flag_type_id)
          return (
            <span
              key={f.id}
              className="inline-flex items-center gap-1.5 rounded-full border border-band-yellow/40 bg-band-yellow/15 px-2.5 py-1 text-xs text-amber-200"
            >
              {t?.label ?? 'Waiting'}
              {f.note ? <span className="opacity-70">· {f.note}</span> : null}
              <button
                className="opacity-60 hover:opacity-100"
                title="Resolve"
                onClick={() => flags.resolve.mutate(f.id)}
              >
                ✕
              </button>
            </span>
          )
        })}
        <select
          className="input w-52"
          value=""
          onChange={(e) => {
            if (e.target.value) flags.add.mutate({ flagTypeId: e.target.value })
          }}
        >
          <option value="">+ Waiting on…</option>
          {(flagTypes ?? []).map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>

        <button
          className="btn btn-primary text-xs"
          onClick={() => addTracking.mutate({ type: 'check_call', note: 'Check call logged' })}
          disabled={addTracking.isPending}
        >
          Log check call
        </button>
        <span className="text-xs text-slate-500">
          {data.tracking.length > 0
            ? `last touch ${relativeTime(data.tracking[0].created_at)}`
            : 'no check calls yet'}
        </span>
      </div>

      {needsReview.length > 0 && (
        <div className="card mb-4 border-band-orange/40 bg-band-orange/5 p-3" data-search-exclude>
          <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-orange-300">
            {needsReview.length} field{needsReview.length === 1 ? '' : 's'} to verify
          </div>
          <div className="flex flex-wrap gap-1.5">
            {needsReview.map(({ field, c }) => (
              <span
                key={field.key}
                className="inline-flex items-center gap-1.5 rounded border border-ink-600 bg-ink-850 px-2 py-0.5 text-xs"
              >
                {field.label}
                <BandPill confidence={c} thresholds={settings?.qcBands} />
              </span>
            ))}
          </div>
        </div>
      )}

      {/* --------------------------------------------------------- content */}
      <div ref={search.containerRef} className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {LOAD_FIELD_GROUPS.map((group) => (
            <section key={group.title} className="card p-3">
              <h2 className="mb-2 text-sm font-semibold text-slate-200">{group.title}</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {group.fields.map((field) => {
                  const extracted = fieldAt(load.raw_extraction, field.path)
                  const value = (load as unknown as Record<string, unknown>)[field.key]
                  return (
                    <FieldEditor
                      key={field.key}
                      label={field.label}
                      help={field.help}
                      type={field.type}
                      confidence={extracted?.c ?? null}
                      rawText={extracted?.raw}
                      thresholds={settings?.qcBands}
                      value={value == null ? '' : String(value)}
                      onCommit={(next) =>
                        updateLoad.mutate({
                          patch: { [field.key]: coerce(next, field.type) },
                          previous: { [field.key]: value },
                        })
                      }
                    />
                  )
                })}
              </div>
            </section>
          ))}

          <StopsPanel
            stops={data.stops}
            loadId={load.id}
            customerId={load.customer_id}
            qcBands={settings?.qcBands}
          />

          {(data.references.length > 0 || data.charges.length > 0) && (
            <section className="card p-3">
              <h2 className="mb-2 text-sm font-semibold text-slate-200">References &amp; charges</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <div className="label">References</div>
                  {data.references.length === 0 && (
                    <div className="text-xs text-slate-500">none</div>
                  )}
                  <ul className="space-y-1 text-sm">
                    {data.references.map((r) => (
                      <li key={r.id} className="flex gap-2">
                        <span className="text-slate-400">{r.label ?? r.qualifier}</span>
                        <span className="font-mono">{r.value}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <div className="label">Charges</div>
                  {data.charges.length === 0 && <div className="text-xs text-slate-500">none</div>}
                  <ul className="space-y-1 text-sm">
                    {data.charges.map((c) => (
                      <li key={c.id} className="flex justify-between gap-2">
                        <span className="text-slate-300">
                          {c.description ?? c.accessorial_code ?? 'Charge'}
                        </span>
                        <span className="font-mono">{c.amount ?? '—'}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </section>
          )}
        </div>

        {/* ----------------------------------------------------- side rail */}
        <div className="space-y-4">
          <AssignParties
            load={load}
            saving={updateLoad.isPending}
            onAssign={(patch) =>
              updateLoad.mutate({
                patch,
                previous: {
                  customer_id: load.customer_id,
                  carrier_id: load.carrier_id,
                },
              })
            }
          />

          <section className="card p-3" data-search-exclude>
            <h2 className="mb-2 text-sm font-semibold text-slate-200">Tracking</h2>
            <TrackingComposer onAdd={(note) => addTracking.mutate({ type: 'check_call', note })} />
            <ul className="mt-3 space-y-2">
              {data.tracking.length === 0 && (
                <li className="text-xs text-slate-500">Nothing logged yet.</li>
              )}
              {data.tracking.map((t) => (
                <li key={t.id} className="border-l-2 border-ink-600 pl-2 text-xs">
                  <div className="text-slate-300">{t.note ?? t.type}</div>
                  <div className="text-slate-500">
                    {t.type} · {relativeTime(t.created_at)}
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section className="card p-3">
            <h2 className="mb-2 text-sm font-semibold text-slate-200">Source</h2>
            <dl className="space-y-1 text-xs">
              <Row label="Origin" value={load.source} />
              <Row label="File" value={load.source_file_name ?? '—'} />
              <Row label="Created" value={relativeTime(load.created_at)} />
              <Row label="Last touched" value={relativeTime(load.last_touched_at)} />
            </dl>
            {load.warnings && load.warnings.length > 0 && (
              <ul className="mt-2 space-y-1">
                {load.warnings.map((w, i) => (
                  <li key={i} className="text-xs text-amber-300">
                    ⚠ {w}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card p-3" data-search-exclude>
            <h2 className="mb-2 text-sm font-semibold text-slate-200">Stage history</h2>
            <ul className="space-y-1.5">
              {data.history.length === 0 && (
                <li className="text-xs text-slate-500">No transitions yet.</li>
              )}
              {data.history.map((h) => {
                const to = stages?.find((s) => s.id === h.to_stage_id)
                const from = stages?.find((s) => s.id === h.from_stage_id)
                return (
                  <li key={h.id} className="text-xs text-slate-400">
                    <span className="text-slate-200">{to?.label ?? 'stage'}</span>
                    {from ? ` ← ${from.label}` : ''} · {relativeTime(h.changed_at)}
                  </li>
                )
              })}
            </ul>
          </section>
        </div>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-slate-300">{value}</dd>
    </div>
  )
}

function coerce(value: string, type?: string): unknown {
  if (value === '') return null
  if (type === 'number' || type === 'money') {
    const n = Number(value.replace(/[^0-9.\-]/g, ''))
    return Number.isNaN(n) ? null : n
  }
  if (type === 'boolean') return value === 'true' || value === 'yes'
  return value
}

/**
 * One QC field: the value a dispatcher edits, the parser's confidence beside
 * it, and (on focus) the raw text the parser read it from — so "why does it
 * think that?" is answerable without opening the PDF.
 */
function FieldEditor({
  label,
  value,
  confidence,
  rawText,
  thresholds,
  type,
  help,
  onCommit,
}: {
  label: string
  value: string
  confidence: number | null
  rawText?: string
  thresholds?: Parameters<typeof bandFor>[1]
  type?: string
  help?: string
  onCommit: (next: string) => void
}) {
  const [draft, setDraft] = useState(value)
  const [focused, setFocused] = useState(false)
  const dirty = draft !== value

  // Keep the input in sync when the row is refetched and we're not editing.
  if (!focused && !dirty && draft !== value) setDraft(value)

  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</span>
        <BandPill confidence={confidence} thresholds={thresholds} />
      </div>
      {type === 'boolean' ? (
        <select
          className="input"
          value={draft || 'false'}
          onChange={(e) => {
            setDraft(e.target.value)
            onCommit(e.target.value)
          }}
        >
          <option value="false">No</option>
          <option value="true">Yes</option>
        </select>
      ) : (
        <input
          className="input"
          type={type === 'date' ? 'date' : 'text'}
          value={draft}
          onFocus={() => setFocused(true)}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            setFocused(false)
            if (dirty) onCommit(draft)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              ;(e.target as HTMLInputElement).blur()
            }
          }}
        />
      )}
      {help && <p className="mt-1 text-[11px] text-slate-500">{help}</p>}
      {focused && rawText && (
        <p className="mt-1 truncate text-[11px] text-slate-500" title={rawText}>
          read from: <span className="font-mono">{rawText}</span>
        </p>
      )}
    </div>
  )
}

function TrackingComposer({ onAdd }: { onAdd: (note: string) => void }) {
  const [note, setNote] = useState('')
  return (
    <div className="flex gap-2">
      <input
        className="input"
        placeholder="Check call note…"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && note.trim()) {
            onAdd(note.trim())
            setNote('')
          }
        }}
      />
      <button
        className="btn"
        disabled={!note.trim()}
        onClick={() => {
          onAdd(note.trim())
          setNote('')
        }}
      >
        Log
      </button>
    </div>
  )
}

function StopsPanel({
  stops,
  loadId,
  customerId,
  qcBands,
}: {
  stops: LoadStop[]
  loadId: string
  customerId: string | null
  qcBands?: Parameters<typeof bandFor>[1]
}) {
  const updateStop = useUpdateStop(loadId)
  // "What did we pick last time" — prior locations for this customer, so a
  // low-confidence extraction is a dropdown pick instead of a retype.
  const { data: knownLocations } = useCustomerLocations(customerId)

  return (
    <section className="card p-3">
      <h2 className="mb-2 text-sm font-semibold text-slate-200">Stops</h2>
      <div className="space-y-3">
        {stops.length === 0 && <div className="text-xs text-slate-500">No stops on this load.</div>}
        {stops.map((stop) => {
          const suggestions = (knownLocations ?? []).filter((l) =>
            stop.stop_type === 'pickup'
              ? l.role === 'pickup' || l.role === 'shipper'
              : l.role === 'delivery',
          )
          return (
            <div key={stop.id} className="rounded border border-ink-700 bg-ink-850 p-3">
              <div className="mb-2 flex items-center gap-2">
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                    stop.stop_type === 'pickup'
                      ? 'bg-sky-500/15 text-sky-300'
                      : 'bg-emerald-500/15 text-emerald-300'
                  }`}
                >
                  {stop.stop_type ?? 'stop'} {stop.sequence ?? ''}
                </span>
                <span className="text-sm text-slate-200">{stop.name ?? 'Unnamed facility'}</span>
                <span className="ml-auto text-xs text-slate-500">
                  {stop.earliest ? relativeTime(stop.earliest) : 'no window'}
                </span>
              </div>

              <div className="grid gap-2 text-sm sm:grid-cols-2">
                <div>
                  <span className="text-slate-400">Address: </span>
                  {stop.address1 ?? '—'}
                </div>
                <div>
                  <span className="text-slate-400">City: </span>
                  {stop.city ?? '—'}, {stop.state ?? '—'} {stop.postal ?? ''}
                </div>
                <div>
                  <span className="text-slate-400">Window: </span>
                  {stop.earliest ?? '—'} → {stop.latest ?? '—'}
                </div>
                <div>
                  <span className="text-slate-400">Appt: </span>
                  {stop.appointment ?? '—'} {stop.appointment_number ?? ''}
                </div>
                {stop.instructions && (
                  <div className="sm:col-span-2">
                    <span className="text-slate-400">Instructions: </span>
                    {stop.instructions}
                  </div>
                )}
              </div>

              {suggestions.length > 0 && (
                <div className="mt-2" data-search-exclude>
                  <select
                    className="input text-xs"
                    value=""
                    onChange={(e) => {
                      const pick = suggestions.find((s) => s.id === e.target.value)
                      if (!pick) return
                      updateStop.mutate({
                        stopId: stop.id,
                        patch: {
                          name: pick.name,
                          address1: pick.address1,
                          city: pick.city,
                          state: pick.state,
                          postal: pick.postal,
                        },
                      })
                    }}
                  >
                    <option value="">Use a location this customer has used before…</option>
                    {suggestions.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} — {s.city}, {s.state} (used {s.use_count}×)
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )
        })}
      </div>
      <p className="mt-2 text-[11px] text-slate-500">
        Stop confidence pills come from the original extraction; bands use the{' '}
        {qcBands ? 'configured' : 'default'} thresholds.
      </p>
    </section>
  )
}
