import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  useAddCarrierInteraction,
  useCarrier,
  useCarrierInteractions,
  useCarrierLoads,
  useSaveCarrier,
} from '@/hooks/useCarriers'
import { useCarrierPerformance, type CarrierPerformanceRow } from '@/hooks/useCarrierPerformance'
import { useStageEventsForLoads } from '@/hooks/useRecordHistory'
import { useProfiles } from '@/hooks/useProfiles'
import { useInteractionTypes, usePipelineStages } from '@/hooks/useSettings'
import { buildTimeline, type TimelineItem } from '@/lib/timeline'
import { relativeTime } from '@/lib/urgency'
import CarrierScorecard from '@/components/CarrierScorecard'
import RecordTimeline from '@/components/RecordTimeline'
import { ContactChips } from '@/components/Contact'
import { OpenInNewTab, ROW_LINK_CLASS, useRowLink } from '@/components/RowLink'
import { StatusPill } from './Carriers'
import type { Carrier, CarrierInteractionView, LoadBoardRow } from '@/types/db'

type Tab = 'overview' | 'activity' | 'loads'

/**
 * A carrier profile a dispatcher can live in: who to call up top, the last
 * 30 days of notes impossible to miss, then one history of everything —
 * every note logged and every stage their loads moved through.
 */
export default function CarrierDetail() {
  const { id } = useParams<{ id: string }>()
  const { data: carrier, isLoading } = useCarrier(id)
  const { data: interactions } = useCarrierInteractions(id)
  const { data: loadRows } = useCarrierLoads(id)
  const { data: performance } = useCarrierPerformance(id)
  const { data: stages } = usePipelineStages()
  const { data: profiles } = useProfiles()
  const [tab, setTab] = useState<Tab>('overview')

  const loads = useMemo(() => (loadRows ?? []) as LoadBoardRow[], [loadRows])
  const loadIds = useMemo(() => loads.map((l) => l.id), [loads])
  const { data: stageEvents } = useStageEventsForLoads(loadIds)

  const recent = useMemo(
    () => (interactions ?? []).filter((i) => i.age_bucket === 'recent'),
    [interactions],
  )
  const caution = useMemo(
    () => (interactions ?? []).filter((i) => i.age_bucket === 'caution'),
    [interactions],
  )

  const timeline = useMemo(
    () =>
      buildTimeline({
        notes: interactions ?? [],
        stageEvents: stageEvents ?? [],
        loads,
        stages: stages ?? [],
        profiles: profiles ?? [],
      }),
    [interactions, stageEvents, loads, stages, profiles],
  )

  if (isLoading) return <div className="p-6 text-sm text-slate-400">Loading carrier…</div>
  if (!carrier) return <div className="p-6 text-sm text-red-300">Carrier not found.</div>

  const lastActivity = timeline[0]?.at ?? null
  const equipment = carrier.equipment_types ?? []

  return (
    <div className="p-4">
      <div className="mb-1 flex flex-wrap items-center gap-3">
        <Link to="/carriers" className="text-sm text-slate-400 hover:text-slate-200">
          ← Carriers
        </Link>
        <h1 className="text-lg font-semibold text-slate-100">{carrier.name}</h1>
        <StatusPill status={carrier.status} />
        {carrier.dot_number && (
          <span className="font-mono text-xs text-slate-400">DOT {carrier.dot_number}</span>
        )}
        {carrier.mc_number && (
          <span className="font-mono text-xs text-slate-400">MC {carrier.mc_number}</span>
        )}
        {carrier.scac && <span className="font-mono text-xs text-slate-400">{carrier.scac}</span>}
        <span className="ml-auto text-xs text-slate-500">
          Last activity {lastActivity ? relativeTime(lastActivity) : 'never'}
        </span>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1">
        <ContactChips
          role="Dispatch"
          name={carrier.dispatch_contact_name}
          phone={carrier.dispatch_contact_phone}
          email={carrier.dispatch_contact_email}
        />
        {carrier.city && (
          <span className="text-sm text-slate-400">
            {carrier.city}, {carrier.state}
          </span>
        )}
        {equipment.length > 0 && (
          <span className="flex flex-wrap gap-1">
            {equipment.map((t) => (
              <span key={t} className="rounded bg-ink-800 px-1.5 py-0.5 text-xs text-slate-300">
                {t}
              </span>
            ))}
          </span>
        )}
      </div>

      {/*
        Anything said about this carrier in the last 30 days is shown up front,
        unprompted. This is the "their turbo blew on Tuesday" guard — it has to
        be impossible to miss while you're deciding whether to book them.
      */}
      {recent.length > 0 && (
        <div className="card mb-4 border-band-yellow/50 bg-band-yellow/10 p-3">
          <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-amber-300">
            Recent activity — last 30 days
          </div>
          <ul className="space-y-1.5">
            {recent.map((i) => (
              <InteractionLine key={i.id} interaction={i} />
            ))}
          </ul>
        </div>
      )}

      <div className="mb-3 flex items-center gap-1">
        <TabButton active={tab === 'overview'} onClick={() => setTab('overview')}>
          Overview
        </TabButton>
        <TabButton active={tab === 'activity'} onClick={() => setTab('activity')}>
          Activity
          {timeline.length > 0 && (
            <span className="ml-1.5 rounded-full bg-ink-700 px-1.5 text-[10px] text-slate-300">
              {timeline.length}
            </span>
          )}
          {caution.length > 0 && (
            <span
              className="ml-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-band-yellow/25 text-[10px] font-bold text-amber-300"
              title={`${caution.length} note(s) from the last year worth checking`}
            >
              !
            </span>
          )}
        </TabButton>
        <TabButton active={tab === 'loads'} onClick={() => setTab('loads')}>
          Loads
          {loads.length > 0 && (
            <span className="ml-1.5 rounded-full bg-ink-700 px-1.5 text-[10px] text-slate-300">
              {loads.length}
            </span>
          )}
        </TabButton>
      </div>

      {tab === 'overview' && (
        <CarrierOverview
          carrier={carrier}
          performance={performance ?? null}
          lastActivity={lastActivity}
        />
      )}
      {tab === 'activity' && (
        <ActivityTab carrierId={carrier.id} timeline={timeline} loads={loads} />
      )}
      {tab === 'loads' && <CarrierLoads loads={loads} />}
    </div>
  )
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center rounded-md px-3 py-1.5 text-sm font-medium transition ${
        active ? 'bg-accent/15 text-accent' : 'text-slate-300 hover:bg-ink-800'
      }`}
    >
      {children}
    </button>
  )
}

function InteractionLine({ interaction: i }: { interaction: CarrierInteractionView }) {
  const severityClass =
    i.severity === 'critical'
      ? 'text-red-300'
      : i.severity === 'warn'
        ? 'text-amber-300'
        : 'text-slate-300'
  return (
    <li className="text-sm">
      <span className={`font-medium ${severityClass}`}>{i.interaction_type_label}</span>
      <span className="text-slate-300"> — {i.body}</span>
      {i.load_id && i.load_number && (
        <Link to={`/loads/${i.load_id}`} className="ml-1 text-xs text-accent hover:underline">
          {i.load_number}
        </Link>
      )}
      <span className="ml-1 text-xs text-slate-500">
        {i.created_by_name ?? 'someone'} · {relativeTime(i.created_at)}
      </span>
    </li>
  )
}

function CarrierOverview({
  carrier,
  performance,
  lastActivity,
}: {
  carrier: Carrier
  performance: CarrierPerformanceRow | null
  lastActivity: string | null
}) {
  const save = useSaveCarrier()
  const [draft, setDraft] = useState<Carrier>(carrier)
  const [equipment, setEquipment] = useState((carrier.equipment_types ?? []).join(', '))

  // Only what the form can change counts as a change — updated_at moving
  // after a save must not leave the button lit.
  const editable = (c: Carrier) => [
    c.name, c.dot_number, c.mc_number, c.scac,
    c.dispatch_contact_name, c.dispatch_contact_phone, c.dispatch_contact_email,
    c.address1, c.city, c.state, c.postal, c.status, c.notes,
  ]
  const dirty =
    equipment !== (carrier.equipment_types ?? []).join(', ') ||
    JSON.stringify(editable(draft)) !== JSON.stringify(editable(carrier))

  const set = (k: keyof Carrier, v: unknown) => setDraft({ ...draft, [k]: v })
  const text = (k: keyof Carrier) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    set(k, e.target.value === '' && k !== 'name' ? null : e.target.value)

  function submit() {
    save.mutate({
      id: carrier.id,
      name: draft.name,
      dot_number: draft.dot_number,
      mc_number: draft.mc_number,
      scac: draft.scac,
      dispatch_contact_name: draft.dispatch_contact_name,
      dispatch_contact_phone: draft.dispatch_contact_phone,
      dispatch_contact_email: draft.dispatch_contact_email,
      address1: draft.address1,
      city: draft.city,
      state: draft.state,
      postal: draft.postal,
      status: draft.status,
      notes: draft.notes,
      equipment_types: equipment
        .split(/[,;]/)
        .map((s) => s.trim())
        .filter(Boolean),
    })
  }

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <section className="card p-3">
          <h2 className="mb-2 text-sm font-semibold text-slate-200">Details</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {(
              [
                ['name', 'Name'],
                ['dot_number', 'DOT #'],
                ['mc_number', 'MC #'],
                ['scac', 'SCAC'],
                ['dispatch_contact_name', 'Dispatch contact'],
                ['dispatch_contact_phone', 'Dispatch phone'],
                ['dispatch_contact_email', 'Dispatch email'],
                ['address1', 'Address'],
                ['city', 'City'],
                ['state', 'State'],
                ['postal', 'Zip'],
              ] as const
            ).map(([key, label]) => (
              <div key={key}>
                <label className="label">{label}</label>
                <input
                  className="input"
                  value={(draft[key] as string | null) ?? ''}
                  onChange={text(key)}
                  required={key === 'name'}
                />
              </div>
            ))}
            <div>
              <label className="label">Status</label>
              <select
                className="input"
                value={draft.status}
                onChange={(e) => set('status', e.target.value)}
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="do_not_use">Do not use</option>
              </select>
            </div>
            <div>
              <label className="label">Equipment</label>
              <input
                className="input"
                placeholder="van, reefer, flatbed"
                value={equipment}
                onChange={(e) => setEquipment(e.target.value)}
              />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Notes</label>
              <textarea
                className="input min-h-[70px]"
                value={draft.notes ?? ''}
                onChange={text('notes')}
              />
            </div>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <button
              className="btn btn-primary"
              disabled={save.isPending || !dirty || !draft.name.trim()}
              onClick={submit}
            >
              {save.isPending ? 'Saving…' : 'Save changes'}
            </button>
            {save.isSuccess && !dirty && <span className="text-xs text-emerald-300">Saved.</span>}
            {save.error && (
              <span className="text-xs text-red-300">{(save.error as Error).message}</span>
            )}
          </div>
        </section>
      </div>

      <div className="space-y-4">
        <section className="card p-3">
          <h2 className="mb-2 text-sm font-semibold text-slate-200">At a glance</h2>
          <dl className="space-y-1 text-xs">
            <Row label="Carrier since" value={relativeTime(carrier.created_at)} />
            <Row label="Last activity" value={lastActivity ? relativeTime(lastActivity) : 'never'} />
            <Row label="Loads hauled" value={String(Number(performance?.loads_total) || 0)} />
            <Row label="Delivered" value={String(Number(performance?.loads_delivered) || 0)} />
            <Row
              label="Last delivered"
              value={performance?.last_delivered_at ? relativeTime(performance.last_delivered_at) : 'never'}
            />
          </dl>
        </section>

        <CarrierScorecard carrierId={carrier.id} />
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

function ActivityTab({
  carrierId,
  timeline,
  loads,
}: {
  carrierId: string
  timeline: TimelineItem[]
  loads: LoadBoardRow[]
}) {
  const { data: types } = useInteractionTypes()
  const add = useAddCarrierInteraction(carrierId)
  const [typeId, setTypeId] = useState('')
  const [body, setBody] = useState('')
  const [loadId, setLoadId] = useState('')
  const [followUp, setFollowUp] = useState('')

  const chosenType = typeId || types?.[0]?.id || ''

  function submit() {
    if (!chosenType || !body.trim()) return
    add.mutate(
      {
        interactionTypeId: chosenType,
        body: body.trim(),
        loadId: loadId || null,
        followUpAt: followUp ? new Date(followUp).toISOString() : null,
      },
      {
        onSuccess: () => {
          setBody('')
          setFollowUp('')
          setLoadId('')
        },
      },
    )
  }

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <RecordTimeline
          items={timeline}
          emptyText="Nothing yet. Notes you log and every stage their loads move through will show up here."
        />
      </div>

      <section className="card p-3">
        <h2 className="mb-2 text-sm font-semibold text-slate-200">Log something</h2>
        <div className="space-y-2">
          <select className="input" value={chosenType} onChange={(e) => setTypeId(e.target.value)}>
            {(types ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
          <textarea
            className="input min-h-[80px]"
            placeholder="e.g. Blew a turbo on the 401 — down about a week"
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <select className="input" value={loadId} onChange={(e) => setLoadId(e.target.value)}>
            <option value="">Not about a specific load</option>
            {loads.slice(0, 50).map((l) => (
              <option key={l.id} value={l.id}>
                {l.load_number} · {l.origin_city} → {l.dest_city}
              </option>
            ))}
          </select>
          <div>
            <label className="label">Remind me to follow up</label>
            <input
              className="input"
              type="date"
              value={followUp}
              onChange={(e) => setFollowUp(e.target.value)}
            />
          </div>
          <button
            className="btn btn-primary w-full justify-center"
            disabled={add.isPending || !body.trim()}
            onClick={submit}
          >
            {add.isPending ? 'Logging…' : 'Log it'}
          </button>
          {add.error && <div className="text-xs text-red-300">{(add.error as Error).message}</div>}
        </div>
      </section>
    </div>
  )
}

function CarrierLoads({ loads }: { loads: LoadBoardRow[] }) {
  return (
    <div className="card overflow-hidden">
      <table className="w-full border-collapse">
        <thead className="border-b border-ink-700 bg-ink-850">
          <tr>
            <th className="th">Load</th>
            <th className="th">Lane</th>
            <th className="th">Pickup</th>
            <th className="th">Customer</th>
            <th className="th">Rate</th>
            <th className="th">Miles</th>
            <th className="th">Stage</th>
            <th className="th w-10" />
          </tr>
        </thead>
        <tbody>
          {loads.length === 0 && (
            <tr>
              <td className="td text-slate-400" colSpan={8}>
                No loads with this carrier yet.
              </td>
            </tr>
          )}
          {loads.map((l) => (
            <CarrierLoadRow key={l.id} load={l} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function CarrierLoadRow({ load: l }: { load: LoadBoardRow }) {
  const href = `/loads/${l.id}`
  const link = useRowLink(href)
  return (
    <tr {...link} className={ROW_LINK_CLASS}>
      <td className="td">
        <Link to={href} className="text-accent hover:underline">
          {l.load_number}
        </Link>
      </td>
      <td className="td text-sm">
        {l.origin_city}, {l.origin_state} → {l.dest_city}, {l.dest_state}
      </td>
      <td className="td text-sm">{relativeTime(l.first_pickup_at)}</td>
      <td className="td text-sm">
        {l.customer_name && l.customer_id ? (
          <Link to={`/customers/${l.customer_id}`} className="hover:text-accent hover:underline">
            {l.customer_name}
          </Link>
        ) : (
          (l.customer_name ?? '—')
        )}
      </td>
      <td className="td text-sm">{l.carrier_rate ? `$${l.carrier_rate}` : '—'}</td>
      <td className="td text-sm">{l.distance_miles ?? '—'}</td>
      <td className="td text-sm">{l.stage_label}</td>
      <td className="td text-right">
        <OpenInNewTab href={href} what="load" />
      </td>
    </tr>
  )
}
