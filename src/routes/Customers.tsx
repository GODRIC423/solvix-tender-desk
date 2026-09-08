import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useCustomerSearch, useSaveCustomer } from '@/hooks/useCustomers'

export default function Customers() {
  const [search, setSearch] = useState('')
  const [showNew, setShowNew] = useState(false)
  const { data: customers, isLoading } = useCustomerSearch(search)
  const save = useSaveCustomer()
  const [name, setName] = useState('')

  return (
    <div className="p-4">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold text-slate-100">Customers</h1>
        <input
          className="input ml-auto w-80"
          placeholder="Search by name, MC #, or city…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoFocus
        />
        <button className="btn btn-primary" onClick={() => setShowNew((v) => !v)}>
          {showNew ? 'Cancel' : 'Add customer'}
        </button>
      </div>

      {showNew && (
        <form
          className="card mb-3 flex flex-wrap items-end gap-3 p-3"
          onSubmit={async (e) => {
            e.preventDefault()
            await save.mutateAsync({ name })
            setName('')
            setShowNew(false)
          }}
        >
          <div className="w-72">
            <label className="label">Customer name</label>
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <button className="btn btn-primary" disabled={save.isPending}>
            Save
          </button>
        </form>
      )}

      <div className="card overflow-hidden">
        <table className="w-full border-collapse">
          <thead className="border-b border-ink-700 bg-ink-850">
            <tr>
              <th className="th">Customer</th>
              <th className="th">MC #</th>
              <th className="th">Location</th>
              <th className="th">Contact</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td className="td text-slate-400" colSpan={4}>
                  Loading…
                </td>
              </tr>
            )}
            {!isLoading && (customers ?? []).length === 0 && (
              <tr>
                <td className="td text-slate-400" colSpan={4}>
                  No customers yet.
                </td>
              </tr>
            )}
            {(customers ?? []).map((c) => (
              <tr key={c.id} className="border-b border-ink-800 hover:bg-ink-850">
                <td className="td">
                  <Link
                    to={`/customers/${c.id}`}
                    className="font-medium text-accent hover:underline"
                  >
                    {c.name}
                  </Link>
                </td>
                <td className="td font-mono text-sm">{c.mc_number ?? '—'}</td>
                <td className="td text-sm">
                  {c.city ? `${c.city}, ${c.state ?? ''}` : <span className="text-slate-500">—</span>}
                </td>
                <td className="td text-sm">{c.main_contact_name ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
