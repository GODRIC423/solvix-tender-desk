import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useCarrierSearch } from '@/hooks/useCarriers'
import { useCustomerSearch } from '@/hooks/useCustomers'
import type { Load } from '@/types/db'

/**
 * Confirming who the load belongs to.
 *
 * Ingest deliberately leaves customer_id and carrier_id null — matching a
 * tender to the wrong customer by fuzzy name is worse than leaving it blank —
 * so this is where a human closes that loop. It is also the moment the desk
 * starts learning: setting the customer fires the trigger that records this
 * load's stops as locations that customer actually uses, which is what fills
 * the "used before" dropdowns on the next tender from them.
 */
export default function AssignParties({
  load,
  onAssign,
  saving,
}: {
  load: Load
  onAssign: (patch: { customer_id?: string | null; carrier_id?: string | null }) => void
  saving?: boolean
}) {
  return (
    <section className="card p-3" data-search-exclude>
      <h2 className="mb-2 text-sm font-semibold text-slate-200">Who this load is for</h2>

      <div className="space-y-3">
        <PartyPicker
          label="Customer"
          kind="customer"
          selectedId={load.customer_id}
          onPick={(id) => onAssign({ customer_id: id })}
          saving={saving}
          hint="Setting this is what teaches the desk this customer's locations."
        />
        <PartyPicker
          label="Carrier"
          kind="carrier"
          selectedId={load.carrier_id}
          onPick={(id) => onAssign({ carrier_id: id })}
          saving={saving}
          hint="Check their recent notes before you book them."
        />
      </div>
    </section>
  )
}

function PartyPicker({
  label,
  kind,
  selectedId,
  onPick,
  saving,
  hint,
}: {
  label: string
  kind: 'customer' | 'carrier'
  selectedId: string | null
  onPick: (id: string | null) => void
  saving?: boolean
  hint?: string
}) {
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)

  const customers = useCustomerSearch(kind === 'customer' ? search : '')
  const carriers = useCarrierSearch(kind === 'carrier' ? search : '')

  const rows =
    kind === 'customer'
      ? (customers.data ?? []).map((c) => ({ id: c.id, primary: c.name, secondary: c.city ?? '' }))
      : (carriers.data ?? []).map((c) => ({
          id: c.id,
          primary: c.name,
          secondary: c.dot_number ? `DOT ${c.dot_number}` : (c.city ?? ''),
        }))

  const selected = rows.find((r) => r.id === selectedId)
  const selectedName =
    selected?.primary ??
    (selectedId
      ? kind === 'customer'
        ? (customers.data ?? []).find((c) => c.id === selectedId)?.name
        : (carriers.data ?? []).find((c) => c.id === selectedId)?.name
      : undefined)

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</span>
        {selectedId && (
          <Link
            to={`/${kind === 'customer' ? 'customers' : 'carriers'}/${selectedId}`}
            className="text-xs text-accent hover:underline"
          >
            open ↗
          </Link>
        )}
      </div>

      {selectedId && !open ? (
        <div className="flex items-center gap-2">
          <span className="flex-1 truncate rounded border border-ink-600 bg-ink-950 px-2.5 py-1.5 text-sm">
            {selectedName ?? 'Assigned'}
          </span>
          <button className="btn text-xs" onClick={() => setOpen(true)} disabled={saving}>
            Change
          </button>
          <button
            className="btn text-xs"
            onClick={() => onPick(null)}
            disabled={saving}
            title={`Clear the ${label.toLowerCase()}`}
          >
            Clear
          </button>
        </div>
      ) : (
        <div>
          <input
            className="input"
            autoFocus={open}
            placeholder={
              kind === 'carrier' ? 'Search by DOT #, MC #, or name…' : 'Search customers…'
            }
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="mt-1 max-h-44 overflow-y-auto rounded border border-ink-700">
            {rows.length === 0 && (
              <div className="px-2.5 py-2 text-xs text-slate-500">
                {search ? 'No match.' : 'Start typing to search.'}
              </div>
            )}
            {rows.slice(0, 25).map((r) => (
              <button
                key={r.id}
                className="flex w-full items-baseline gap-2 px-2.5 py-1.5 text-left text-sm hover:bg-ink-800"
                onClick={() => {
                  onPick(r.id)
                  setOpen(false)
                  setSearch('')
                }}
              >
                <span className="text-slate-200">{r.primary}</span>
                {r.secondary && <span className="text-xs text-slate-500">{r.secondary}</span>}
              </button>
            ))}
          </div>
          {open && (
            <button className="btn mt-1 text-xs" onClick={() => setOpen(false)}>
              Cancel
            </button>
          )}
        </div>
      )}
      {hint && <p className="mt-1 text-[11px] text-slate-500">{hint}</p>}
    </div>
  )
}
