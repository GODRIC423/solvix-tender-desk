import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { usePipelineStages } from '@/hooks/useSettings'
import { openStoredFile } from '@/hooks/useDocuments'
import { useInvoices, useMarkInvoicePaid, useUpdateInvoice, type InvoiceRow } from '@/hooks/useInvoices'
import { fmtDate, money, round2, toIsoDate } from '@/lib/documents/data'
import { exportRows } from '@/components/CsvImport'
import { todayStamp } from '@/lib/csv'
import InvoiceStatusPill from '@/components/InvoiceStatusPill'
import type { InvoiceStatus } from '@/types/db'

const FILTERS: Array<{ key: InvoiceStatus | 'all'; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'draft', label: 'Draft' },
  { key: 'sent', label: 'Sent' },
  { key: 'paid', label: 'Paid' },
  { key: 'void', label: 'Void' },
]

function lane(r: InvoiceRow): string {
  const l = r.loads
  if (!l?.origin_city && !l?.dest_city) return '—'
  return `${l?.origin_city ?? '?'}, ${l?.origin_state ?? ''} → ${l?.dest_city ?? '?'}, ${l?.dest_state ?? ''}`
}

/** Every invoice, what is still owed, and the two clicks that move money along. */
export default function Invoices() {
  const { can } = useAuth()
  const canBill = can('manage_billing')
  const [status, setStatus] = useState<InvoiceStatus | 'all'>('all')
  const { data: rows, isLoading, error } = useInvoices({ status })
  const { data: stages } = usePipelineStages()
  const update = useUpdateInvoice()
  const markPaid = useMarkInvoicePaid()
  const [actionError, setActionError] = useState<string | null>(null)

  const today = toIsoDate(new Date())
  const totals = useMemo(() => {
    const all = rows ?? []
    const sent = all.filter((r) => r.status === 'sent')
    return {
      outstanding: round2(sent.reduce((s, r) => s + Number(r.total), 0)),
      overdue: round2(sent.filter((r) => r.due_at && r.due_at < today).reduce((s, r) => s + Number(r.total), 0)),
      paid: round2(all.filter((r) => r.status === 'paid').reduce((s, r) => s + Number(r.total), 0)),
      drafts: all.filter((r) => r.status === 'draft').length,
    }
  }, [rows, today])

  function exportCsv() {
    exportRows(
      `invoices-${todayStamp()}.csv`,
      [
        { key: 'invoice_number', label: 'Invoice #' },
        { key: 'status', label: 'Status' },
        { key: 'customer', label: 'Customer' },
        { key: 'load_number', label: 'Load #' },
        { key: 'lane', label: 'Lane' },
        { key: 'issued_at', label: 'Issued' },
        { key: 'due_at', label: 'Due' },
        { key: 'total', label: 'Total' },
        { key: 'currency', label: 'Currency' },
        { key: 'sent_at', label: 'Sent' },
        { key: 'paid_at', label: 'Paid' },
        { key: 'delivered_at', label: 'Delivered' },
      ],
      (rows ?? []).map((r) => ({
        invoice_number: r.invoice_number,
        status: r.status,
        customer: r.customers?.name ?? '',
        load_number: r.loads?.load_number ?? '',
        lane: lane(r),
        issued_at: r.issued_at,
        due_at: r.due_at ?? '',
        total: r.total,
        currency: r.currency,
        sent_at: r.sent_at ?? '',
        paid_at: r.paid_at ?? '',
        delivered_at: r.loads?.delivered_at ?? '',
      })),
    )
  }

  function act(fn: Promise<unknown>) {
    setActionError(null)
    fn.catch((e) => setActionError((e as Error).message))
  }

  const paidStage = stages?.find((s) => s.key === 'paid') ?? null

  return (
    <div className="p-4">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold text-slate-100">Invoices</h1>
        <div className="flex items-center gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setStatus(f.key)}
              className={`rounded-full border px-2.5 py-1 text-xs font-medium transition ${
                status === f.key
                  ? 'border-accent/50 bg-accent/15 text-accent'
                  : 'border-ink-600 bg-ink-800 text-slate-300 hover:bg-ink-700'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {(rows ?? []).length > 0 && (
            <button className="btn" onClick={exportCsv} title="Download what is listed as a CSV">
              Export CSV
            </button>
          )}
        </div>
      </div>

      <div className="mb-3 grid gap-3 sm:grid-cols-4">
        <Tile label="Outstanding" value={money(totals.outstanding)} hint="sent, not yet paid" />
        <Tile label="Overdue" value={money(totals.overdue)} hint="past the due date" tone={totals.overdue > 0 ? 'red' : undefined} />
        <Tile label="Paid" value={money(totals.paid)} hint="in this view" />
        <Tile label="Drafts" value={String(totals.drafts)} hint="created, not sent" />
      </div>

      {error && (
        <div className="card mb-3 border-band-red/40 bg-band-red/10 p-3 text-sm text-red-300">
          Couldn&apos;t load invoices: {(error as Error).message}
        </div>
      )}
      {actionError && <div className="mb-3 text-xs text-red-300">{actionError}</div>}

      <div className="card overflow-hidden">
        <table className="w-full border-collapse">
          <thead className="border-b border-ink-700 bg-ink-850">
            <tr>
              <th className="th">Invoice</th>
              <th className="th">Customer</th>
              <th className="th">Load</th>
              <th className="th">Lane</th>
              <th className="th">Issued</th>
              <th className="th">Due</th>
              <th className="th">Total</th>
              <th className="th">Status</th>
              <th className="th" />
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td className="td text-slate-400" colSpan={9}>
                  Loading…
                </td>
              </tr>
            )}
            {!isLoading && (rows ?? []).length === 0 && (
              <tr>
                <td className="td text-slate-400" colSpan={9}>
                  No invoices yet. Open a delivered load and use <span className="text-slate-200">Create invoice</span> in its
                  Documents panel.
                </td>
              </tr>
            )}
            {(rows ?? []).map((r) => {
              const overdue = r.status === 'sent' && r.due_at && r.due_at < today
              return (
                <tr key={r.id} className="border-b border-ink-800 hover:bg-ink-850">
                  <td className="td font-mono text-sm">{r.invoice_number}</td>
                  <td className="td text-sm">
                    {r.customer_id ? (
                      <Link to={`/customers/${r.customer_id}`} className="hover:text-accent hover:underline">
                        {r.customers?.name ?? 'Customer'}
                      </Link>
                    ) : (
                      <span className="text-slate-500">—</span>
                    )}
                  </td>
                  <td className="td text-sm">
                    <Link to={`/loads/${r.load_id}`} className="text-accent hover:underline">
                      {r.loads?.load_number ?? 'load'}
                    </Link>
                  </td>
                  <td className="td text-sm">{lane(r)}</td>
                  <td className="td text-sm">{fmtDate(r.issued_at)}</td>
                  <td className={`td text-sm ${overdue ? 'text-red-300' : ''}`}>{fmtDate(r.due_at)}</td>
                  <td className="td text-sm">{money(r.total, r.currency)}</td>
                  <td className="td">
                    <InvoiceStatusPill status={r.status} />
                  </td>
                  <td className="td">
                    <div className="flex flex-wrap justify-end gap-1">
                      {r.load_documents && (
                        <button
                          className="btn text-xs"
                          onClick={() => act(openStoredFile('load-documents', r.load_documents!.storage_path))}
                        >
                          PDF
                        </button>
                      )}
                      {canBill && r.status === 'draft' && (
                        <button
                          className="btn text-xs"
                          onClick={() =>
                            act(update.mutateAsync({ id: r.id, patch: { status: 'sent', sent_at: new Date().toISOString() } }))
                          }
                        >
                          Mark sent
                        </button>
                      )}
                      {canBill && (r.status === 'draft' || r.status === 'sent') && (
                        <button
                          className="btn btn-primary text-xs"
                          onClick={() =>
                            act(markPaid.mutateAsync({ invoiceId: r.id, loadId: r.load_id, paidStageId: paidStage?.id ?? null }))
                          }
                        >
                          Mark paid
                        </button>
                      )}
                      {canBill && r.status !== 'paid' && r.status !== 'void' && (
                        <button
                          className="btn text-xs"
                          title="Cancel this invoice. It stays on record as void."
                          onClick={() => {
                            if (window.confirm(`Void ${r.invoice_number}?`)) act(update.mutateAsync({ id: r.id, patch: { status: 'void' } }))
                          }}
                        >
                          Void
                        </button>
                      )}
                    </div>
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

function Tile({ label, value, hint, tone }: { label: string; value: string; hint: string; tone?: 'red' }) {
  return (
    <div className={`card p-3 ${tone === 'red' ? 'border-band-red/40' : ''}`}>
      <div className="label">{label}</div>
      <div className={`text-xl font-semibold ${tone === 'red' ? 'text-red-300' : 'text-slate-100'}`}>{value}</div>
      <div className="text-[11px] text-slate-500">{hint}</div>
    </div>
  )
}
