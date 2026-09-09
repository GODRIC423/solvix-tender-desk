import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  fetchAllCustomers,
  useCustomerSearch,
  useDueFollowUps,
  useImportCustomers,
  useSaveCustomer,
} from '@/hooks/useCustomers'
import { useAuth } from '@/hooks/useAuth'
import { useSettings } from '@/hooks/useSettings'
import CsvImport, { exportRows, type CsvColumn } from '@/components/CsvImport'
import { todayStamp } from '@/lib/csv'
import { relativeTime } from '@/lib/urgency'

export const CUSTOMER_COLUMNS: CsvColumn[] = [
  { key: 'name', label: 'Customer name', required: true, example: 'Acme Foods Inc.' },
  {
    key: 'mc_number',
    label: 'MC number',
    example: '123456',
    help: 'Used to match an existing customer; otherwise the name is matched exactly.',
  },
  { key: 'industry', label: 'Industry', example: 'Food & beverage' },
  { key: 'address1', label: 'Address', example: '1800 Industrial Blvd' },
  { key: 'address2', label: 'Address 2', example: '' },
  { key: 'city', label: 'City', example: 'Marietta' },
  { key: 'state', label: 'State', example: 'GA', help: 'Two letters.' },
  { key: 'postal', label: 'Zip', example: '30062' },
  { key: 'main_contact_name', label: 'Main contact', example: 'Jordan Lee' },
  { key: 'main_contact_phone', label: 'Contact phone', example: '(770) 555-0100' },
  { key: 'main_contact_email', label: 'Contact email', example: 'jordan@acmefoods.com' },
  { key: 'website', label: 'Website', example: 'https://acmefoods.com' },
  { key: 'linkedin_url', label: 'LinkedIn', example: 'https://linkedin.com/company/acme-foods' },
  { key: 'notes', label: 'Notes', example: 'Ships Mon–Thu, no Friday pickups' },
  { key: 'active', label: 'Active', example: 'yes', values: ['yes', 'no'], help: 'Blank means yes.' },
]

export default function Customers() {
  const [search, setSearch] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const { data: customers, isLoading } = useCustomerSearch(search)
  const { data: due } = useDueFollowUps()
  const { data: settings } = useSettings()
  const { can } = useAuth()
  const save = useSaveCustomer()
  const importCustomers = useImportCustomers()
  const [name, setName] = useState('')

  const quietDays = settings?.interactionAging.recent_days ?? 30

  async function onExport() {
    setExporting(true)
    setExportError(null)
    try {
      const all = await fetchAllCustomers()
      exportRows(
        `customers-${todayStamp()}.csv`,
        CUSTOMER_COLUMNS.map((c) => ({ key: c.key as keyof (typeof all)[number] & string, label: c.label })),
        all as unknown as Record<string, unknown>[],
      )
    } catch (e) {
      setExportError((e as Error).message)
    } finally {
      setExporting(false)
    }
  }

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
        {can('import_customers') && (
          <button className="btn" onClick={() => setShowImport((v) => !v)}>
            {showImport ? 'Close import' : 'Import'}
          </button>
        )}
        {can('export_customers') && (
          <button className="btn" onClick={onExport} disabled={exporting} title="Download every customer as a CSV">
            {exporting ? 'Exporting…' : 'Export'}
          </button>
        )}
        <button className="btn btn-primary" onClick={() => setShowNew((v) => !v)}>
          {showNew ? 'Cancel' : 'Add customer'}
        </button>
      </div>

      {exportError && <div className="mb-3 text-xs text-red-300">{exportError}</div>}

      {/* Follow-ups that are due — the "get back to good customers" nudge. */}
      {(due ?? []).length > 0 && (
        <div className="card mb-3 border-band-yellow/40 bg-band-yellow/10 p-3">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-amber-300">
            Follow-ups due
          </div>
          <ul className="space-y-1 text-sm">
            {(due ?? []).slice(0, 6).map((f) => (
              <li key={f.id} className="flex flex-wrap items-baseline gap-2">
                <Link to={`/customers/${f.customer_id}`} className="text-accent hover:underline">
                  <CustomerName id={f.customer_id} customers={customers ?? []} />
                </Link>
                <span className="text-slate-300">{f.body}</span>
                <span className="text-xs text-slate-500">
                  {f.interaction_type_label} · due {relativeTime(f.follow_up_at)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {showImport && (
        <div className="mb-3">
          <CsvImport
            title="Import customers"
            entity="customers"
            columns={CUSTOMER_COLUMNS}
            templateFilename="customers-template.csv"
            onImport={(rows) => importCustomers.mutateAsync(rows)}
            onDone={() => setShowImport(false)}
          />
        </div>
      )}

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
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
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
              <th className="th">Industry</th>
              <th className="th">Location</th>
              <th className="th">Contact</th>
              <th className="th">Last activity</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td className="td text-slate-400" colSpan={5}>
                  Loading…
                </td>
              </tr>
            )}
            {!isLoading && (customers ?? []).length === 0 && (
              <tr>
                <td className="td text-slate-400" colSpan={5}>
                  No customers yet.{can('import_customers') ? ' Import a spreadsheet or add one.' : ''}
                </td>
              </tr>
            )}
            {(customers ?? []).map((c) => {
              const quiet =
                !c.last_activity_at ||
                Date.now() - new Date(c.last_activity_at).getTime() > quietDays * 86_400_000
              return (
                <tr key={c.id} className="border-b border-ink-800 hover:bg-ink-850">
                  <td className="td">
                    <Link to={`/customers/${c.id}`} className="font-medium text-accent hover:underline">
                      {c.name}
                    </Link>
                    {c.mc_number && <div className="font-mono text-xs text-slate-500">MC {c.mc_number}</div>}
                    {!c.active && (
                      <span className="ml-1 rounded bg-ink-800 px-1 text-[10px] uppercase text-slate-400">
                        inactive
                      </span>
                    )}
                  </td>
                  <td className="td text-sm">{c.industry ?? <span className="text-slate-500">—</span>}</td>
                  <td className="td text-sm">
                    {c.city ? `${c.city}, ${c.state ?? ''}` : <span className="text-slate-500">—</span>}
                  </td>
                  <td className="td text-sm">
                    {c.main_contact_name ?? '—'}
                    {c.main_contact_phone && (
                      <div className="text-xs text-slate-500">{c.main_contact_phone}</div>
                    )}
                  </td>
                  <td className="td text-sm">
                    <span className={quiet ? 'text-slate-500' : 'text-slate-200'}>
                      {c.last_activity_at ? relativeTime(c.last_activity_at) : 'never'}
                    </span>
                    {quiet && c.active && (
                      <span
                        className="ml-1.5 rounded bg-band-yellow/15 px-1 text-[10px] uppercase text-amber-300"
                        title={`Nothing logged in ${quietDays} days`}
                      >
                        quiet
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function CustomerName({ id, customers }: { id: string; customers: Array<{ id: string; name: string }> }) {
  return <>{customers.find((c) => c.id === id)?.name ?? 'Customer'}</>
}
