import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  useAddCustomerInteraction,
  useCustomer,
  useCustomerInteractions,
  useCustomerLocations,
  useLoadsForCustomer,
  useSaveCustomer,
} from '@/hooks/useCustomers'
import { useProfiles } from '@/hooks/useProfiles'
import { useStageEventsForLoads } from '@/hooks/useRecordHistory'
import { useCustomerInteractionTypes, usePipelineStages } from '@/hooks/useSettings'
import { useAuth } from '@/hooks/useAuth'
import { buildTimeline, type TimelineItem } from '@/lib/timeline'
import { relativeTime } from '@/lib/urgency'
import RecordTimeline from '@/components/RecordTimeline'
import { ContactChips } from '@/components/Contact'
import { OpenInNewTab, ROW_LINK_CLASS, useRowLink } from '@/components/RowLink'
import type { Customer, LoadBoardRow, QuickLink } from '@/types/db'

type Tab = 'overview' | 'activity' | 'loads' | 'locations'

/**
 * A customer profile a sales desk can live in: contacts and links up top,
 * an activity log that records every call and email, and the loads and
 * locations the desk has learned. "It's not just keeping the data but also
 * seeing what's new with them."
 */
export default function CustomerDetail() {
  const { id } = useParams<{ id: string }>()
  const { data: customer, isLoading } = useCustomer(id)
  const { data: interactions } = useCustomerInteractions(id)
  const { data: loadRows } = useLoadsForCustomer(id)
  const { data: stages } = usePipelineStages()
  const { data: profiles } = useProfiles()
  const [tab, setTab] = useState<Tab>('overview')

  const loads = useMemo(() => (loadRows ?? []) as LoadBoardRow[], [loadRows])
  const loadIds = useMemo(() => loads.map((l) => l.id), [loads])
  const { data: stageEvents } = useStageEventsForLoads(loadIds)
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

  if (isLoading) return <div className="p-6 text-sm text-slate-400">Loading customer…</div>
  if (!customer) return <div className="p-6 text-sm text-red-300">Customer not found.</div>

  const links: Array<{ label: string; url: string | null }> = [
    { label: 'Website', url: customer.website },
    { label: 'LinkedIn', url: customer.linkedin_url },
    { label: 'Facebook', url: customer.facebook_url },
    { label: 'Instagram', url: customer.instagram_url },
    { label: 'X', url: customer.x_url },
    ...(customer.quick_links ?? []).map((q) => ({ label: q.label, url: q.url })),
  ].filter((l) => l.url)

  return (
    <div className="p-4">
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <Link to="/customers" className="text-sm text-slate-400 hover:text-slate-200">
          ← Customers
        </Link>
        <h1 className="text-lg font-semibold text-slate-100">{customer.name}</h1>
        {customer.industry && <span className="text-xs text-slate-400">{customer.industry}</span>}
        {!customer.active && (
          <span className="rounded bg-ink-800 px-1.5 py-0.5 text-[10px] uppercase text-slate-400">inactive</span>
        )}
        <span className="ml-auto text-xs text-slate-500">
          Last activity {customer.last_activity_at ? relativeTime(customer.last_activity_at) : 'never'}
        </span>
      </div>

      {links.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {links.map((l) => (
            <a
              key={l.label + l.url}
              href={l.url!}
              target="_blank"
              rel="noreferrer"
              className="btn text-xs"
              title={l.url!}
            >
              {l.label} ↗
            </a>
          ))}
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1">
        <ContactChips
          role="Main contact"
          name={customer.main_contact_name}
          phone={customer.main_contact_phone}
          email={customer.main_contact_email}
        />
        {customer.city && (
          <span className="text-sm text-slate-400">
            {customer.city}, {customer.state}
          </span>
        )}
      </div>

      <div className="mb-3 flex items-center gap-1">
        <TabButton active={tab === 'overview'} onClick={() => setTab('overview')}>
          Overview
        </TabButton>
        <TabButton active={tab === 'activity'} onClick={() => setTab('activity')}>
          Activity
          {(interactions ?? []).length > 0 && (
            <span className="ml-1.5 rounded-full bg-ink-700 px-1.5 text-[10px] text-slate-300">
              {(interactions ?? []).length}
            </span>
          )}
        </TabButton>
        <TabButton active={tab === 'loads'} onClick={() => setTab('loads')}>
          Loads
        </TabButton>
        <TabButton active={tab === 'locations'} onClick={() => setTab('locations')}>
          Locations
        </TabButton>
      </div>

      {tab === 'overview' && <Overview customer={customer} />}
      {tab === 'activity' && <Activity customerId={customer.id} timeline={timeline} loads={loads} />}
      {tab === 'loads' && <LoadsTab loads={loads} />}
      {tab === 'locations' && <LocationsTab customerId={customer.id} />}
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

function Overview({ customer }: { customer: Customer }) {
  const save = useSaveCustomer()
  const { data: profiles } = useProfiles()
  const { can } = useAuth()
  const canEdit = can('edit_loads')
  const [draft, setDraft] = useState<Customer>(customer)
  const dirty = JSON.stringify(draft) !== JSON.stringify(customer)

  const set = (k: keyof Customer, v: unknown) => setDraft({ ...draft, [k]: v })
  const text = (k: keyof Customer) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    set(k, e.target.value === '' ? null : e.target.value)

  const quick = draft.quick_links ?? []

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <section className="card p-3">
          <h2 className="mb-2 text-sm font-semibold text-slate-200">Details</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {(
              [
                ['name', 'Name'],
                ['industry', 'Industry'],
                ['mc_number', 'MC #'],
                ['main_contact_name', 'Main contact'],
                ['main_contact_phone', 'Phone'],
                ['main_contact_email', 'Email'],
                ['address1', 'Address'],
                ['city', 'City'],
                ['state', 'State'],
                ['postal', 'Zip'],
              ] as const
            ).map(([key, label]) => (
              <div key={key}>
                <label className="label">{label}</label>
                <input className="input" disabled={!canEdit} value={(draft[key] as string | null) ?? ''} onChange={text(key)} />
              </div>
            ))}
            <div>
              <label className="label">Account owner</label>
              <select
                className="input"
                disabled={!canEdit}
                value={draft.account_owner_id ?? ''}
                onChange={(e) => set('account_owner_id', e.target.value || null)}
              >
                <option value="">— nobody yet —</option>
                {(profiles ?? [])
                  .filter((p) => p.active)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.full_name ?? p.email}
                    </option>
                  ))}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="label">Notes</label>
              <textarea className="input min-h-[70px]" disabled={!canEdit} value={draft.notes ?? ''} onChange={text('notes')} />
            </div>
          </div>
        </section>

        <section className="card p-3">
          <h2 className="mb-1 text-sm font-semibold text-slate-200">Links</h2>
          <p className="mb-2 text-xs text-slate-500">
            The pages you open for this account. Quick links are anything else — their load portal,
            invoice site, a shared drive.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {(
              [
                ['website', 'Website'],
                ['linkedin_url', 'LinkedIn'],
                ['facebook_url', 'Facebook'],
                ['instagram_url', 'Instagram'],
                ['x_url', 'X / Twitter'],
              ] as const
            ).map(([key, label]) => (
              <div key={key}>
                <label className="label">{label}</label>
                <input
                  className="input"
                  type="url"
                  placeholder="https://"
                  disabled={!canEdit}
                  value={(draft[key] as string | null) ?? ''}
                  onChange={text(key)}
                />
              </div>
            ))}
          </div>
          <div className="mt-3">
            <div className="label">Quick links</div>
            <div className="space-y-1.5">
              {quick.map((q, i) => (
                <div key={i} className="flex gap-1.5">
                  <input
                    className="input w-40"
                    placeholder="Label"
                    disabled={!canEdit}
                    value={q.label}
                    onChange={(e) => set('quick_links', quick.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                  />
                  <input
                    className="input"
                    placeholder="https://"
                    disabled={!canEdit}
                    value={q.url}
                    onChange={(e) => set('quick_links', quick.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))}
                  />
                  {canEdit && (
                    <button
                      type="button"
                      className="btn text-xs"
                      onClick={() => set('quick_links', quick.filter((_, j) => j !== i))}
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
              {canEdit && (
                <button
                  type="button"
                  className="btn text-xs"
                  onClick={() => set('quick_links', [...quick, { label: '', url: '' } as QuickLink])}
                >
                  + Quick link
                </button>
              )}
            </div>
          </div>
        </section>

        {canEdit && (
          <div className="flex items-center gap-3">
            <button
              className="btn btn-primary"
              disabled={save.isPending || !dirty}
              onClick={() =>
                save.mutate({
                  ...draft,
                  quick_links: quick.filter((q) => q.url.trim() !== ''),
                })
              }
            >
              {save.isPending ? 'Saving…' : 'Save changes'}
            </button>
            {save.isSuccess && !dirty && <span className="text-xs text-emerald-300">Saved.</span>}
            {save.error && <span className="text-xs text-red-300">{(save.error as Error).message}</span>}
          </div>
        )}
      </div>

      <div className="space-y-4">
        <section className="card p-3">
          <h2 className="mb-2 text-sm font-semibold text-slate-200">At a glance</h2>
          <dl className="space-y-1 text-xs">
            <Row label="Customer since" value={relativeTime(customer.created_at)} />
            <Row label="Last activity" value={customer.last_activity_at ? relativeTime(customer.last_activity_at) : 'never'} />
            <Row label="Status" value={customer.active ? 'Active' : 'Inactive'} />
          </dl>
          {canEdit && (
            <button
              className="btn mt-3 text-xs"
              onClick={() => save.mutate({ id: customer.id, name: customer.name, active: !customer.active })}
            >
              {customer.active ? 'Mark inactive' : 'Mark active'}
            </button>
          )}
        </section>
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

function Activity({
  customerId,
  timeline,
  loads,
}: {
  customerId: string
  timeline: TimelineItem[]
  loads: LoadBoardRow[]
}) {
  const { data: types } = useCustomerInteractionTypes()
  const add = useAddCustomerInteraction(customerId)
  const { can } = useAuth()
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
          emptyText="Nothing yet. Calls, emails and quotes you log, and every stage their loads move through, will show up here so the next person knows where things stand."
        />
      </div>

      {can('edit_loads') && (
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
              placeholder="What happened?"
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
              <input className="input" type="date" value={followUp} onChange={(e) => setFollowUp(e.target.value)} />
            </div>
            <button className="btn btn-primary w-full justify-center" disabled={add.isPending || !body.trim()} onClick={submit}>
              {add.isPending ? 'Logging…' : 'Log it'}
            </button>
            {add.error && <div className="text-xs text-red-300">{(add.error as Error).message}</div>}
          </div>
        </section>
      )}
    </div>
  )
}

function LoadsTab({ loads }: { loads: LoadBoardRow[] }) {
  return (
    <div className="card overflow-hidden">
      <table className="w-full border-collapse">
        <thead className="border-b border-ink-700 bg-ink-850">
          <tr>
            <th className="th">Load</th>
            <th className="th">Lane</th>
            <th className="th">Pickup</th>
            <th className="th">Carrier</th>
            <th className="th">Rate</th>
            <th className="th">Stage</th>
            <th className="th w-10" />
          </tr>
        </thead>
        <tbody>
          {loads.length === 0 && (
            <tr>
              <td className="td text-slate-400" colSpan={7}>
                No loads for this customer yet.
              </td>
            </tr>
          )}
          {loads.map((l) => (
            <CustomerLoadRow key={l.id} load={l} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function CustomerLoadRow({ load: l }: { load: LoadBoardRow }) {
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
        {l.carrier_name && l.carrier_id ? (
          <Link to={`/carriers/${l.carrier_id}`} className="hover:text-accent hover:underline">
            {l.carrier_name}
          </Link>
        ) : (
          (l.carrier_name ?? '—')
        )}
      </td>
      <td className="td text-sm">
        {l.customer_rate !== null ? `$${l.customer_rate.toLocaleString('en-US')}` : '—'}
      </td>
      <td className="td text-sm">{l.stage_label}</td>
      <td className="td text-right">
        <OpenInNewTab href={href} what="load" />
      </td>
    </tr>
  )
}

/*
  The learned location list. Every time a load's stop is confirmed at QC,
  that location's use_count goes up — so this list becomes the customer's
  real footprint, ordered by how often they actually ship there.
*/
function LocationsTab({ customerId }: { customerId: string }) {
  const { data: locations } = useCustomerLocations(customerId)
  return (
    <div className="card p-3">
      <h2 className="mb-2 text-sm font-semibold text-slate-200">Known locations</h2>
      {(locations ?? []).length === 0 ? (
        <p className="text-xs text-slate-500">
          None yet. Locations are remembered as loads for this customer are confirmed, then offered
          as dropdown picks on future tenders.
        </p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {(locations ?? []).map((l) => (
            <li key={l.id} className="rounded border border-ink-700 bg-ink-850 p-2 text-sm">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-slate-200">{l.name ?? l.address1}</span>
                <span className="text-xs text-slate-500">{l.use_count}×</span>
              </div>
              <div className="text-xs text-slate-400">
                {l.address1 && <div>{l.address1}</div>}
                {l.city}, {l.state} {l.postal} · {l.role} · {relativeTime(l.last_used_at)}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
