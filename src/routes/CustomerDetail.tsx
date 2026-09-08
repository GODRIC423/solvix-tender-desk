import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  useCustomer,
  useCustomerLocations,
  useLoadsForCustomer,
  useSaveCustomer,
} from '@/hooks/useCustomers'
import { relativeTime } from '@/lib/urgency'
import type { LoadBoardRow } from '@/types/db'

export default function CustomerDetail() {
  const { id } = useParams<{ id: string }>()
  const { data: customer, isLoading } = useCustomer(id)
  const { data: locations } = useCustomerLocations(id)
  const { data: loads } = useLoadsForCustomer(id)
  const save = useSaveCustomer()
  const [draft, setDraft] = useState<any>(null)

  if (isLoading) return <div className="p-6 text-sm text-slate-400">Loading customer…</div>
  if (!customer) return <div className="p-6 text-sm text-red-300">Customer not found.</div>

  const model = draft ?? customer

  return (
    <div className="p-4">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Link to="/customers" className="text-sm text-slate-400 hover:text-slate-200">
          ← Customers
        </Link>
        <h1 className="text-lg font-semibold text-slate-100">{customer.name}</h1>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card p-3 lg:col-span-2">
          <h2 className="mb-2 text-sm font-semibold text-slate-200">Details</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {(
              [
                ['name', 'Name'],
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
                <input
                  className="input"
                  value={model[key] ?? ''}
                  onChange={(e) => setDraft({ ...model, [key]: e.target.value })}
                />
              </div>
            ))}
          </div>
          <button
            className="btn btn-primary mt-3"
            disabled={save.isPending || !draft}
            onClick={() => save.mutate(model)}
          >
            {save.isPending ? 'Saving…' : 'Save changes'}
          </button>
        </div>

        {/*
          The learned location list. Every time a load's stop is confirmed at QC,
          that location's use_count goes up — so this list becomes the customer's
          real footprint, ordered by how often they actually ship there.
        */}
        <div className="card p-3">
          <h2 className="mb-2 text-sm font-semibold text-slate-200">Known locations</h2>
          {(locations ?? []).length === 0 ? (
            <p className="text-xs text-slate-500">
              None yet. Locations are remembered as loads for this customer are QC&apos;d, then
              offered as dropdown picks on future tenders.
            </p>
          ) : (
            <ul className="space-y-2">
              {(locations ?? []).map((l) => (
                <li key={l.id} className="text-sm">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-slate-200">{l.name ?? l.address1}</span>
                    <span className="text-xs text-slate-500">{l.use_count}×</span>
                  </div>
                  <div className="text-xs text-slate-400">
                    {l.city}, {l.state} {l.postal} · {l.role} · {relativeTime(l.last_used_at)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="card mt-4 overflow-hidden">
        <table className="w-full border-collapse">
          <thead className="border-b border-ink-700 bg-ink-850">
            <tr>
              <th className="th">Load</th>
              <th className="th">Lane</th>
              <th className="th">Pickup</th>
              <th className="th">Carrier</th>
              <th className="th">Stage</th>
            </tr>
          </thead>
          <tbody>
            {((loads ?? []) as LoadBoardRow[]).length === 0 && (
              <tr>
                <td className="td text-slate-400" colSpan={5}>
                  No loads for this customer yet.
                </td>
              </tr>
            )}
            {((loads ?? []) as LoadBoardRow[]).map((l) => (
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
                <td className="td text-sm">{l.carrier_name ?? '—'}</td>
                <td className="td text-sm">{l.stage_label}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
