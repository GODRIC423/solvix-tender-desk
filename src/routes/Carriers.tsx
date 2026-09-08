import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useCarrierSearch, useSaveCarrier } from '@/hooks/useCarriers'

export default function Carriers() {
  const [search, setSearch] = useState('')
  const [showNew, setShowNew] = useState(false)
  const { data: carriers, isLoading } = useCarrierSearch(search)

  return (
    <div className="p-4">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold text-slate-100">Carriers</h1>
        <input
          className="input ml-auto w-80"
          placeholder="Search by DOT #, MC #, or name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoFocus
        />
        <button className="btn btn-primary" onClick={() => setShowNew((v) => !v)}>
          {showNew ? 'Cancel' : 'Add carrier'}
        </button>
      </div>

      {showNew && <NewCarrierForm onDone={() => setShowNew(false)} />}

      <div className="card overflow-hidden">
        <table className="w-full border-collapse">
          <thead className="border-b border-ink-700 bg-ink-850">
            <tr>
              <th className="th">Carrier</th>
              <th className="th">DOT #</th>
              <th className="th">MC #</th>
              <th className="th">Location</th>
              <th className="th">Equipment</th>
              <th className="th">Status</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td className="td text-slate-400" colSpan={6}>
                  Loading…
                </td>
              </tr>
            )}
            {!isLoading && (carriers ?? []).length === 0 && (
              <tr>
                <td className="td text-slate-400" colSpan={6}>
                  No carriers yet.
                </td>
              </tr>
            )}
            {(carriers ?? []).map((c) => (
              <tr key={c.id} className="border-b border-ink-800 hover:bg-ink-850">
                <td className="td">
                  <Link to={`/carriers/${c.id}`} className="font-medium text-accent hover:underline">
                    {c.name}
                  </Link>
                </td>
                <td className="td font-mono text-sm">{c.dot_number ?? '—'}</td>
                <td className="td font-mono text-sm">{c.mc_number ?? '—'}</td>
                <td className="td text-sm">
                  {c.city ? `${c.city}, ${c.state ?? ''}` : <span className="text-slate-500">—</span>}
                </td>
                <td className="td text-sm">{c.equipment_types?.join(', ') ?? '—'}</td>
                <td className="td">
                  <StatusPill status={c.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function StatusPill({ status }: { status: string }) {
  const cls =
    status === 'do_not_use'
      ? 'border-band-red/40 bg-band-red/15 text-red-300'
      : status === 'inactive'
        ? 'border-ink-600 bg-ink-800 text-slate-400'
        : 'border-band-green/40 bg-band-green/15 text-emerald-300'
  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${cls}`}>
      {status.replace(/_/g, ' ')}
    </span>
  )
}

function NewCarrierForm({ onDone }: { onDone: () => void }) {
  const save = useSaveCarrier()
  const [name, setName] = useState('')
  const [dot, setDot] = useState('')
  const [mc, setMc] = useState('')

  return (
    <form
      className="card mb-3 flex flex-wrap items-end gap-3 p-3"
      onSubmit={async (e) => {
        e.preventDefault()
        await save.mutateAsync({ name, dot_number: dot || null, mc_number: mc || null })
        onDone()
      }}
    >
      <div className="w-64">
        <label className="label">Carrier name</label>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
      </div>
      <div className="w-40">
        <label className="label">DOT #</label>
        <input className="input" value={dot} onChange={(e) => setDot(e.target.value)} />
      </div>
      <div className="w-40">
        <label className="label">MC #</label>
        <input className="input" value={mc} onChange={(e) => setMc(e.target.value)} />
      </div>
      <button className="btn btn-primary" disabled={save.isPending}>
        Save
      </button>
      {save.error && <span className="text-xs text-red-300">{(save.error as Error).message}</span>}
    </form>
  )
}
