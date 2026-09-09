import { useCallback, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  useAddStop,
  useAddTrackingEvent,
  useDeleteLoad,
  useDeleteStop,
  useLoad,
  useLoadFlags,
  useLoadReferences,
  useSaveStop,
  useSetLoadStage,
  useUpdateLoad,
  useUpdateStop,
  type ManualStopInput,
} from '@/hooks/useLoads'
import { useFlagTypes, usePipelineStages, useSettings } from '@/hooks/useSettings'
import { useAuth } from '@/hooks/useAuth'
import { useInPageSearch, useFindShortcut } from '@/hooks/useInPageSearch'
import { useCustomerLocations } from '@/hooks/useCustomers'
import { formatInZone, resolveStopZone, toDateTimeLocal } from '@/hooks/useStopActuals'
import { LOAD_FIELD_GROUPS, confidenceAt, fieldAt } from '@/lib/load-fields'
import { bandFor, BAND_SEVERITY } from '@/lib/qc-bands'
import { urgencyFor, relativeTime } from '@/lib/urgency'
import { BandDot, BandPill, QcScoreBadge } from '@/components/BandPill'
import AssignParties from '@/components/AssignParties'
import StopArrival from '@/components/StopArrival'
import LaneCarrierPicker from '@/components/LaneCarrierPicker'
import StopForm, { emptyStop } from '@/components/StopForm'
import type { LoadStop } from '@/types/db'

export default function LoadDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { data, isLoading, error } = useLoad(id)
  const { data: settings } = useSettings()
  const { data: stages } = usePipelineStages()
  const { data: flagTypes } = useFlagTypes()
  const { flagRules, can, isAdmin, profile } = useAuth()
  const canEdit = can('edit_loads')

  const updateLoad = useUpdateLoad(id!)
  const setStage = useSetLoadStage(id!)
  const addTracking = useAddTrackingEvent(id!)
  const flags = useLoadFlags(id!)
  const refs = useLoadReferences(id!)
  const deleteLoad = useDeleteLoad()

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
        phase: stage?.phase ?? null,
      },
      flagRules,
    )
  }, [data, stage, flagRules])

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
  const canDeleteThis = load.is_test ? isAdmin || load.created_by === profile?.id : can('delete_loads')

  return (
    <div className="p-4">
      {/* ---------------------------------------------------------- header */}
      <div className="mb-4 flex flex-wrap items-center gap-3" data-search-exclude>
        <Link to="/loads" className="text-sm text-slate-400 hover:text-slate-200">
          ← Board
        </Link>
        <h1 className="text-lg font-semibold text-slate-100">{load.load_number}</h1>
        {load.is_test && (
          <span
            className="rounded bg-fuchsia-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-fuchsia-300"
            title="A test load — left out of reports"
          >
            test load
          </span>
        )}
        {urgency && <BandDot band={urgency.band} title={urgency.reason} />}
        {load.source === 'manual' ? (
          <span className="text-xs text-slate-500" title="Typed in by hand — nothing to QC">
            manual entry
          </span>
        ) : (
          <QcScoreBadge score={load.qc_score} thresholds={settings?.qcBands} />
        )}

        <select
          className="input w-48"
          value={load.pipeline_stage_id}
          disabled={!canEdit}
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
          {canDeleteThis && (
            <button
              className="btn btn-danger text-xs"
              disabled={deleteLoad.isPending}
              onClick={() => {
                if (!window.confirm(`Delete ${load.load_number}? This cannot be undone.`)) return
                deleteLoad.mutate(load.id, { onSuccess: () => navigate('/loads') })
              }}
            >
              Delete{load.is_test ? ' test load' : ''}
            </button>
          )}
        </div>
      </div>

      {!canEdit && (
        <div className="card mb-4 border-band-yellow/40 bg-band-yellow/10 p-3 text-xs text-amber-200" data-search-exclude>
          Read-only: your account can&apos;t edit loads.
        </div>
      )}

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
              {canEdit && (
                <button
                  className="opacity-60 hover:opacity-100"
                  title="Resolve"
                  onClick={() => flags.resolve.mutate(f.id)}
                >
                  ✕
                </button>
              )}
            </span>
          )
        })}
        {canEdit && (
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
        )}

        {canEdit && (
          <button
            className="btn btn-primary text-xs"
            onClick={() => addTracking.mutate({ type: 'check_call', note: 'Check call logged' })}
            disabled={addTracking.isPending}
          >
            Log check call
          </button>
        )}
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
          <StopsPanel
            stops={data.stops}
            loadId={load.id}
            customerId={load.customer_id}
            canEdit={canEdit}
          />

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
                      confidence={load.source === 'manual' ? null : (extracted?.c ?? null)}
                      rawText={extracted?.raw}
                      thresholds={settings?.qcBands}
                      disabled={!canEdit}
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

          <section className="card p-3">
            <h2 className="mb-2 text-sm font-semibold text-slate-200">References &amp; charges</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <div className="label">Reference numbers</div>
                {data.references.length === 0 && (
                  <div className="text-xs text-slate-500">none</div>
                )}
                <ul className="space-y-1 text-sm">
                  {data.references.map((r) => (
                    <li key={r.id} className="flex items-center gap-2">
                      <span className="text-slate-400">{r.label ?? r.qualifier}</span>
                      <span className="font-mono">{r.value}</span>
                      {canEdit && (
                        <button
                          className="ml-auto text-xs text-slate-500 hover:text-red-300"
                          title="Remove"
                          onClick={() => refs.remove.mutate(r.id)}
                        >
                          ✕
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
                {canEdit && <ReferenceComposer onAdd={(label, value) => refs.add.mutate({ label, value })} />}
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
        </div>

        {/* ----------------------------------------------------- side rail */}
        <div className="space-y-4">
          <AssignParties
            load={load}
            saving={updateLoad.isPending || !canEdit}
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

          {/*
            Who has run this lane before. Routed through the same update path as
            AssignParties so there is one way a carrier gets onto a load, not two.
          */}
          <LaneCarrierPicker
            originMetroId={load.origin_metro_id}
            destMetroId={load.dest_metro_id}
            selectedCarrierId={load.carrier_id}
            saving={updateLoad.isPending || !canEdit}
            originMetroName={load.origin_city}
            destMetroName={load.dest_city}
            onSelect={(carrierId) =>
              updateLoad.mutate({
                patch: { carrier_id: carrierId },
                previous: { carrier_id: load.carrier_id },
              })
            }
          />

          <section className="card p-3" data-search-exclude>
            <h2 className="mb-2 text-sm font-semibold text-slate-200">Tracking</h2>
            {canEdit && (
              <TrackingComposer onAdd={(note) => addTracking.mutate({ type: 'check_call', note })} />
            )}
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
  disabled,
  onCommit,
}: {
  label: string
  value: string
  confidence: number | null
  rawText?: string
  thresholds?: Parameters<typeof bandFor>[1]
  type?: string
  help?: string
  disabled?: boolean
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
        {confidence !== null && <BandPill confidence={confidence} thresholds={thresholds} />}
      </div>
      {type === 'boolean' ? (
        <select
          className="input"
          value={draft || 'false'}
          disabled={disabled}
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
          disabled={disabled}
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

function ReferenceComposer({ onAdd }: { onAdd: (label: string, value: string) => void }) {
  const [label, setLabel] = useState('PO')
  const [value, setValue] = useState('')
  return (
    <div className="mt-2 flex gap-1" data-search-exclude>
      <input
        className="input w-20"
        list="ref-labels"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
      />
      <datalist id="ref-labels">
        {['PO', 'BOL', 'PRO', 'Pickup #', 'Delivery #', 'Seal', 'Trailer'].map((l) => (
          <option key={l} value={l} />
        ))}
      </datalist>
      <input
        className="input"
        placeholder="number"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && value.trim()) {
            e.preventDefault()
            onAdd(label.trim() || 'REF', value.trim())
            setValue('')
          }
        }}
      />
      <button
        className="btn text-xs"
        disabled={!value.trim()}
        onClick={() => {
          onAdd(label.trim() || 'REF', value.trim())
          setValue('')
        }}
      >
        Add
      </button>
    </div>
  )
}

/** A LoadStop row, as the editor form wants it: wall-clock in the dock's zone. */
function stopToInput(stop: LoadStop): ManualStopInput {
  const { zone } = resolveStopZone(stop)
  const local = (iso: string | null) => (iso ? toDateTimeLocal(iso, zone) : null)
  return {
    stop_type: (stop.stop_type ?? 'other') as ManualStopInput['stop_type'],
    name: stop.name,
    address1: stop.address1,
    address2: stop.address2,
    city: stop.city,
    state: stop.state,
    postal: stop.postal,
    contact_name: stop.contact_name,
    phone: stop.phone,
    email: stop.email,
    appointment_local: local(stop.appointment),
    earliest_local: local(stop.earliest),
    latest_local: local(stop.latest),
    appointment_number: stop.appointment_number,
    weight: stop.weight,
    quantity: stop.quantity,
    instructions: stop.instructions,
  }
}

function StopsPanel({
  stops,
  loadId,
  customerId,
  canEdit,
}: {
  stops: LoadStop[]
  loadId: string
  customerId: string | null
  canEdit: boolean
}) {
  const updateStop = useUpdateStop(loadId)
  const saveStop = useSaveStop(loadId)
  const addStop = useAddStop(loadId)
  const deleteStop = useDeleteStop(loadId)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<ManualStopInput | null>(null)
  const [adding, setAdding] = useState<ManualStopInput | null>(null)
  // "What did we pick last time" — prior locations for this customer, so a
  // low-confidence extraction is a dropdown pick instead of a retype.
  const { data: knownLocations } = useCustomerLocations(customerId)

  const err = (saveStop.error ?? addStop.error ?? deleteStop.error) as Error | null

  return (
    <section className="card p-3">
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-sm font-semibold text-slate-200">Stops</h2>
        {canEdit && !adding && (
          <div className="ml-auto flex gap-1" data-search-exclude>
            <button className="btn text-xs" onClick={() => setAdding(emptyStop('pickup'))}>
              + Pickup
            </button>
            <button className="btn text-xs" onClick={() => setAdding(emptyStop('delivery'))}>
              + Delivery
            </button>
          </div>
        )}
      </div>
      {err && <div className="mb-2 text-xs text-red-300">{err.message}</div>}
      <div className="space-y-3">
        {stops.length === 0 && !adding && (
          <div className="text-xs text-slate-500">No stops on this load yet.</div>
        )}
        {stops.map((stop) => {
          const suggestions = (knownLocations ?? []).filter((l) =>
            stop.stop_type === 'pickup'
              ? l.role === 'pickup' || l.role === 'shipper'
              : l.role === 'delivery',
          )
          const { zone, dockLocal } = resolveStopZone(stop)
          const when = (iso: string | null) => (iso ? formatInZone(iso, zone) : '—')
          const editing = editingId === stop.id && draft

          return (
            <div key={stop.id} className="rounded border border-ink-700 bg-ink-850 p-3">
              <div className="mb-2 flex items-center gap-2">
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                    stop.stop_type === 'pickup'
                      ? 'bg-sky-500/15 text-sky-300'
                      : stop.stop_type === 'delivery'
                        ? 'bg-emerald-500/15 text-emerald-300'
                        : 'bg-ink-700 text-slate-300'
                  }`}
                >
                  {stop.stop_type ?? 'stop'} {stop.sequence ?? ''}
                </span>
                <span className="text-sm text-slate-200">{stop.name ?? 'Unnamed facility'}</span>
                <span className="ml-auto text-xs text-slate-500">
                  {stop.appointment
                    ? `appt ${relativeTime(stop.appointment)}`
                    : stop.earliest
                      ? `window ${relativeTime(stop.earliest)}`
                      : 'no time set'}
                </span>
                {canEdit && !editing && (
                  <button
                    className="btn text-xs"
                    data-search-exclude
                    onClick={() => {
                      setEditingId(stop.id)
                      setDraft(stopToInput(stop))
                    }}
                  >
                    Edit
                  </button>
                )}
              </div>

              {editing ? (
                <div data-search-exclude>
                  <StopForm value={draft} onChange={setDraft} compact />
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      className="btn btn-primary text-xs"
                      disabled={saveStop.isPending}
                      onClick={() =>
                        saveStop.mutate(
                          { stopId: stop.id, stop: draft },
                          {
                            onSuccess: () => {
                              setEditingId(null)
                              setDraft(null)
                            },
                          },
                        )
                      }
                    >
                      {saveStop.isPending ? 'Saving…' : 'Save stop'}
                    </button>
                    <button
                      className="btn text-xs"
                      onClick={() => {
                        setEditingId(null)
                        setDraft(null)
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      className="btn btn-danger ml-auto text-xs"
                      disabled={deleteStop.isPending}
                      onClick={() => {
                        if (!window.confirm('Remove this stop?')) return
                        deleteStop.mutate(stop.id, {
                          onSuccess: () => {
                            setEditingId(null)
                            setDraft(null)
                          },
                        })
                      }}
                    >
                      Remove stop
                    </button>
                  </div>
                </div>
              ) : (
                <>
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
                      {when(stop.earliest)} → {when(stop.latest)}
                    </div>
                    <div>
                      <span className="text-slate-400">Appt: </span>
                      {when(stop.appointment)} {stop.appointment_number ?? ''}
                    </div>
                    {(stop.contact_name || stop.phone) && (
                      <div>
                        <span className="text-slate-400">Contact: </span>
                        {stop.contact_name ?? ''} {stop.phone ?? ''}
                      </div>
                    )}
                    {stop.instructions && (
                      <div className="sm:col-span-2">
                        <span className="text-slate-400">Instructions: </span>
                        {stop.instructions}
                      </div>
                    )}
                  </div>
                  {!dockLocal && (stop.earliest || stop.appointment) && (
                    <div className="mt-1 text-[11px] text-amber-300/80">
                      No dock zone on this stop — times shown in your local zone.
                    </div>
                  )}

                  <div className="mt-2" data-search-exclude>
                    <StopArrival stop={stop} loadId={loadId} />
                  </div>

                  {canEdit && suggestions.length > 0 && (
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
                </>
              )}
            </div>
          )
        })}

        {adding && (
          <div className="rounded border border-accent/40 bg-ink-850 p-3" data-search-exclude>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-accent">
              New {adding.stop_type}
            </div>
            <StopForm value={adding} onChange={setAdding} compact />
            <div className="mt-2 flex gap-2">
              <button
                className="btn btn-primary text-xs"
                disabled={addStop.isPending}
                onClick={() => addStop.mutate(adding, { onSuccess: () => setAdding(null) })}
              >
                {addStop.isPending ? 'Adding…' : 'Add stop'}
              </button>
              <button className="btn text-xs" onClick={() => setAdding(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
