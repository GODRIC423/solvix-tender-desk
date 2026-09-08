import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  useAddCarrierInteraction,
  useCarrier,
  useCarrierInteractions,
  useCarrierLoads,
  useSaveCarrier,
} from '@/hooks/useCarriers'
import { useInteractionTypes } from '@/hooks/useSettings'
import { relativeTime } from '@/lib/urgency'
import { StatusPill } from './Carriers'
import type { CarrierInteractionView, LoadBoardRow } from '@/types/db'

type Tab = 'overview' | 'interactions' | 'loads'

export default function CarrierDetail() {
  const { id } = useParams<{ id: string }>()
  const { data: carrier, isLoading } = useCarrier(id)
  const { data: interactions } = useCarrierInteractions(id)
  const { data: loads } = useCarrierLoads(id)
  const [tab, setTab] = useState<Tab>('overview')

  const recent = useMemo(
    () => (interactions ?? []).filter((i) => i.age_bucket === 'recent'),
    [interactions],
  )
  const caution = useMemo(
    () => (interactions ?? []).filter((i) => i.age_bucket === 'caution'),
    [interactions],
  )

  if (isLoading) return <div className="p-6 text-sm text-slate-400">Loading carrier…</div>
  if (!carrier) return <div className="p-6 text-sm text-red-300">Carrier not found.</div>

  return (
    <div className="p-4">
      <div className="mb-3 flex flex-wrap items-center gap-3">
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
        <TabButton active={tab === 'interactions'} onClick={() => setTab('interactions')}>
          Interactions
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
        </TabButton>
      </div>

      {tab === 'overview' && <CarrierOverview carrier={carrier} loads={(loads ?? []) as LoadBoardRow[]} />}
      {tab === 'interactions' && (
        <InteractionsTab carrierId={carrier.id} interactions={interactions ?? []} />
      )}
      {tab === 'loads' && <CarrierLoads loads={(loads ?? []) as LoadBoardRow[]} />}
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

function InteractionLine({ interaction }: { interaction: CarrierInteractionView }) {
  const severityClass =
    interaction.severity === 'critical'
      ? 'text-red-300'
      : interaction.severity === 'warn'
        ? 'text-amber-300'
        : 'text-slate-300'
  return (
    <li className="text-sm">
      <span className={`font-medium ${severityClass}`}>{interaction.type_label}</span>
      <span className="text-slate-300"> — {interaction.body}</span>
      <span className="ml-1 text-xs text-slate-500">{relativeTime(interaction.created_at)}</span>
    </li>
  )
}

function CarrierOverview({ carrier, loads }: { carrier: any; loads: LoadBoardRow[] }) {
  const save = useSaveCarrier()
  const [draft, setDraft] = useState(carrier)

  // Phase 1 shows the raw inputs to the performance numbers; the computed
  // on-time % and rate-per-mile-by-direction rollups land in Phase 2.
  const stats = useMemo(() => {
    const withRate = loads.filter((l) => l.carrier_rate && l.distance_miles)
    const rpm = withRate.length
      ? withRate.reduce((sum, l) => sum + Number(l.carrier_rate) / Number(l.distance_miles), 0) /
        withRate.length
      : null
    return { loadCount: loads.length, rpm }
  }, [loads])

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="card p-3 lg:col-span-2">
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
              ['city', 'City'],
              ['state', 'State'],
            ] as const
          ).map(([key, label]) => (
            <div key={key}>
              <label className="label">{label}</label>
              <input
                className="input"
                value={draft[key] ?? ''}
                onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
              />
            </div>
          ))}
          <div>
            <label className="label">Status</label>
            <select
              className="input"
              value={draft.status}
              onChange={(e) => setDraft({ ...draft, status: e.target.value })}
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="do_not_use">Do not use</option>
            </select>
          </div>
        </div>
        <button
          className="btn btn-primary mt-3"
          disabled={save.isPending}
          onClick={() => save.mutate(draft)}
        >
          {save.isPending ? 'Saving…' : 'Save changes'}
        </button>
      </div>

      <div className="card p-3">
        <h2 className="mb-2 text-sm font-semibold text-slate-200">Performance</h2>
        <dl className="space-y-1.5 text-sm">
          <div className="flex justify-between">
            <dt className="text-slate-400">Loads hauled</dt>
            <dd>{stats.loadCount}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-400">Avg rate / mile</dt>
            <dd>{stats.rpm ? `$${stats.rpm.toFixed(2)}` : '—'}</dd>
          </div>
        </dl>
        <p className="mt-3 text-[11px] text-slate-500">
          On-time percentage and east/west rate-per-mile split arrive in Phase 2, once actual
          arrival times are being captured. The columns they read from already exist.
        </p>
      </div>
    </div>
  )
}

function InteractionsTab({
  carrierId,
  interactions,
}: {
  carrierId: string
  interactions: CarrierInteractionView[]
}) {
  const { data: types } = useInteractionTypes()
  const add = useAddCarrierInteraction(carrierId)
  const [typeId, setTypeId] = useState('')
  const [body, setBody] = useState('')

  const grouped = useMemo(
    () => ({
      recent: interactions.filter((i) => i.age_bucket === 'recent'),
      caution: interactions.filter((i) => i.age_bucket === 'caution'),
      archive: interactions.filter((i) => i.age_bucket === 'archive'),
    }),
    [interactions],
  )

  return (
    <div className="space-y-4">
      <form
        className="card flex flex-wrap items-end gap-3 p-3"
        onSubmit={(e) => {
          e.preventDefault()
          if (!typeId || !body.trim()) return
          add.mutate({ interactionTypeId: typeId, body: body.trim() })
          setBody('')
        }}
      >
        <div className="w-56">
          <label className="label">What happened</label>
          <select
            className="input"
            value={typeId}
            onChange={(e) => setTypeId(e.target.value)}
            required
          >
            <option value="">Choose…</option>
            {(types ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-[18rem] flex-1">
          <label className="label">Note</label>
          <input
            className="input"
            placeholder="e.g. Blew a turbo on the 401 — down about a week"
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </div>
        <button className="btn btn-primary" disabled={add.isPending}>
          Log it
        </button>
      </form>

      <Section title="Last 30 days" items={grouped.recent} emptyText="Nothing recent." />
      <Section
        title="30 days – 1 year"
        items={grouped.caution}
        emptyText="Nothing in the last year."
      />
      <Section title="Older" items={grouped.archive} emptyText="No older notes." />
    </div>
  )
}

function Section({
  title,
  items,
  emptyText,
}: {
  title: string
  items: CarrierInteractionView[]
  emptyText: string
}) {
  return (
    <section className="card p-3">
      <h2 className="mb-2 text-sm font-semibold text-slate-200">{title}</h2>
      {items.length === 0 ? (
        <p className="text-xs text-slate-500">{emptyText}</p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((i) => (
            <InteractionLine key={i.id} interaction={i} />
          ))}
        </ul>
      )}
    </section>
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
            <th className="th">Rate</th>
            <th className="th">Miles</th>
            <th className="th">Stage</th>
          </tr>
        </thead>
        <tbody>
          {loads.length === 0 && (
            <tr>
              <td className="td text-slate-400" colSpan={6}>
                No loads with this carrier yet.
              </td>
            </tr>
          )}
          {loads.map((l) => (
            <tr key={l.id} className="border-b border-ink-800 hover:bg-ink-850">
              <td className="td">
                <Link to={`/loads/${l.id}`} className="text-accent hover:underline">
                  {l.load_number}
                </Link>
              </td>
              <td className="td text-sm">
                {l.origin_city}, {l.origin_state} → {l.dest_city}, {l.dest_state}
              </td>
              <td className="td text-sm">{relativeTime(l.first_pickup_at)}</td>
              <td className="td text-sm">{l.carrier_rate ? `$${l.carrier_rate}` : '—'}</td>
              <td className="td text-sm">{l.distance_miles ?? '—'}</td>
              <td className="td text-sm">{l.stage_label}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
