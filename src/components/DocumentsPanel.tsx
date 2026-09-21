import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { logoUrl, usePipelineStages, useSettings } from '@/hooks/useSettings'
import { useCustomer } from '@/hooks/useCustomers'
import { useCarrier } from '@/hooks/useCarriers'
import { useSetLoadStage, type LoadDetail } from '@/hooks/useLoads'
import {
  downloadBlob,
  openStoredFile,
  uploadPageUrl,
  useAddLoadDocument,
  useCreateUploadLink,
  useDeleteLoadDocument,
  useLoadDocuments,
  useRevokeUploadLink,
  useUploadLinks,
} from '@/hooks/useDocuments'
import { useCreateInvoice, useLoadInvoices, useUpdateInvoice } from '@/hooks/useInvoices'
import {
  LOAD_DOCUMENT_KINDS,
  UPLOAD_KINDS,
  dueDate,
  fileSize,
  fmtDate,
  invoiceLinesForLoad,
  money,
  nextVersion,
  toIsoDate,
} from '@/lib/documents/data'
import type { GeneratedLoadKind, LoadDocContext } from '@/lib/documents'
import { relativeTime } from '@/lib/urgency'
import InvoiceStatusPill from './InvoiceStatusPill'
import type { LoadDocumentKind } from '@/types/db'

/**
 * Everything on paper for one load: build the rate confirmation, BOL, load
 * sheet and invoice from what the desk knows; keep what comes back (POD,
 * carrier invoice, receipts); and hand the carrier a link to send theirs in.
 */
export default function DocumentsPanel({ data }: { data: LoadDetail }) {
  const { load } = data
  const { can, isAdmin } = useAuth()
  const canEdit = can('edit_loads')
  const canBill = can('manage_billing')
  const { data: settings } = useSettings()
  const { data: stages } = usePipelineStages()
  const { data: customer } = useCustomer(load.customer_id ?? undefined)
  const { data: carrier } = useCarrier(load.carrier_id ?? undefined)
  const { data: docs } = useLoadDocuments(load.id)
  const { data: links } = useUploadLinks(load.id)
  const { data: invoices } = useLoadInvoices(load.id)
  const addDoc = useAddLoadDocument(load.id)
  const deleteDoc = useDeleteLoadDocument(load.id)
  const createLink = useCreateUploadLink(load.id)
  const revokeLink = useRevokeUploadLink(load.id)
  const createInvoice = useCreateInvoice()
  const updateInvoice = useUpdateInvoice()
  const setStage = useSetLoadStage(load.id)

  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [uploadKind, setUploadKind] = useState<LoadDocumentKind>('pod')
  const [uploadNote, setUploadNote] = useState('')
  const [copied, setCopied] = useState<string | null>(null)

  const company = settings?.company
  const context = useMemo<LoadDocContext | null>(
    () =>
      company
        ? {
            company,
            logoUrl: logoUrl(company.logo_path),
            load,
            stops: data.stops,
            parties: data.parties,
            references: data.references,
            charges: data.charges,
            customer: customer ?? null,
            carrier: carrier ?? null,
            defaultTimezone: settings?.defaultTimezone ?? 'America/Chicago',
          }
        : null,
    [company, load, data.stops, data.parties, data.references, data.charges, customer, carrier, settings?.defaultTimezone],
  )

  const openInvoices = (invoices ?? []).filter((i) => i.status !== 'void')

  async function generate(kind: GeneratedLoadKind) {
    if (!context) return
    setBusy(kind)
    setError(null)
    try {
      const { generateLoadDocument } = await import('@/lib/documents')
      const file = await generateLoadDocument(kind, context, nextVersion(docs ?? [], kind))
      await addDoc.mutateAsync({
        file: file.blob,
        fileName: file.fileName,
        kind,
        origin: 'generated',
        contentType: 'application/pdf',
      })
      downloadBlob(file.blob, file.fileName)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  async function makeInvoice() {
    if (!context || !company) return
    const lines = invoiceLinesForLoad(load, data.charges)
    if (lines.length === 0) {
      setError('Enter a customer rate on the load before invoicing it.')
      return
    }
    setBusy('invoice')
    setError(null)
    try {
      const issued = toIsoDate(new Date())
      const created = await createInvoice.mutateAsync({
        load_id: load.id,
        customer_id: load.customer_id,
        issued_at: issued,
        due_at: dueDate(issued, company.payment_terms_days),
        lines,
      })
      const { generateLoadDocument } = await import('@/lib/documents')
      const file = await generateLoadDocument('invoice', { ...context, invoice: created })
      const doc = await addDoc.mutateAsync({
        file: file.blob,
        fileName: file.fileName,
        kind: 'invoice',
        origin: 'generated',
        contentType: 'application/pdf',
      })
      await updateInvoice.mutateAsync({ id: created.invoice.id, patch: { document_id: doc.id } })

      // Move the load along to "invoiced" unless it is already there or past it.
      const invoiced = stages?.find((s) => s.key === 'invoiced')
      const current = stages?.find((s) => s.id === load.pipeline_stage_id)
      if (invoiced && current && !current.is_terminal && current.sort_order < invoiced.sort_order) {
        await setStage.mutateAsync({ stageId: invoiced.id })
      }
      downloadBlob(file.blob, file.fileName)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy('upload')
    setError(null)
    try {
      await addDoc.mutateAsync({
        file,
        fileName: file.name,
        kind: uploadKind,
        origin: 'uploaded',
        notes: uploadNote.trim() || null,
        contentType: file.type || undefined,
      })
      setUploadNote('')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  async function copy(url: string, id: string) {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(id)
      setTimeout(() => setCopied(null), 2000)
    } catch {
      window.prompt('Copy this link', url)
    }
  }

  const liveLinks = (links ?? []).filter((l) => !l.revoked_at)

  return (
    <section className="card p-3" data-search-exclude>
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-sm font-semibold text-slate-200">Documents</h2>
        {(docs ?? []).length > 0 && (
          <span className="rounded-full bg-ink-700 px-1.5 text-[10px] text-slate-300">{(docs ?? []).length}</span>
        )}
      </div>

      {company && !company.name && (
        <p className="mb-2 text-xs text-amber-300">
          Add your company name and logo under Settings → Company &amp; documents so these print with
          your letterhead.
        </p>
      )}
      {error && <div className="mb-2 text-xs text-red-300">{error}</div>}

      {canEdit && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          <button
            className="btn text-xs"
            disabled={busy !== null || !carrier}
            title={carrier ? 'Build the rate confirmation for the carrier to sign' : 'Assign a carrier first'}
            onClick={() => generate('rate_confirmation')}
          >
            {busy === 'rate_confirmation' ? 'Building…' : 'Rate confirmation'}
          </button>
          <button className="btn text-xs" disabled={busy !== null} onClick={() => generate('bol')}>
            {busy === 'bol' ? 'Building…' : 'Bill of lading'}
          </button>
          <button className="btn text-xs" disabled={busy !== null} onClick={() => generate('load_sheet')}>
            {busy === 'load_sheet' ? 'Building…' : 'Load sheet'}
          </button>
          {canBill && openInvoices.length === 0 && (
            <button
              className="btn btn-primary text-xs"
              disabled={busy !== null || !load.customer_id}
              title={load.customer_id ? 'Invoice the customer for this load' : 'Assign a customer first'}
              onClick={() => void makeInvoice()}
            >
              {busy === 'invoice' ? 'Invoicing…' : 'Create invoice'}
            </button>
          )}
        </div>
      )}

      {openInvoices.length > 0 && (
        <div className="mb-3 space-y-1 rounded border border-ink-700 bg-ink-850 p-2 text-xs">
          {openInvoices.map((inv) => (
            <div key={inv.id} className="flex flex-wrap items-center gap-2">
              <Link to="/invoices" className="font-mono text-accent hover:underline">
                {inv.invoice_number}
              </Link>
              <span className="text-slate-300">{money(inv.total, inv.currency)}</span>
              <InvoiceStatusPill status={inv.status} />
              <span className="ml-auto text-slate-500">due {fmtDate(inv.due_at)}</span>
            </div>
          ))}
        </div>
      )}

      <ul className="space-y-1.5">
        {(docs ?? []).length === 0 && <li className="text-xs text-slate-500">Nothing on file yet.</li>}
        {(docs ?? []).map((d) => (
          <li key={d.id} className="text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`rounded px-1.5 py-0.5 text-[10px] uppercase ${
                  d.origin === 'generated' ? 'bg-accent/15 text-accent' : 'bg-ink-700 text-slate-300'
                }`}
              >
                {LOAD_DOCUMENT_KINDS[d.kind]?.label ?? d.kind}
              </span>
              <button
                className="min-w-0 truncate text-left text-slate-200 hover:text-accent hover:underline"
                title="Open"
                onClick={() => openStoredFile('load-documents', d.storage_path).catch((e) => setError((e as Error).message))}
              >
                {d.file_name}
              </button>
              {d.version > 1 && <span className="text-[10px] text-slate-500">v{d.version}</span>}
              <span className="ml-auto text-[11px] text-slate-500">
                {fileSize(d.size_bytes)} · {relativeTime(d.created_at)}
                {d.uploaded_via === 'carrier_link' ? ' · from carrier' : ''}
              </span>
              {isAdmin && (
                <button
                  className="text-xs text-slate-500 hover:text-red-300"
                  title="Delete"
                  onClick={() => {
                    if (window.confirm(`Delete ${d.file_name}?`)) deleteDoc.mutate(d)
                  }}
                >
                  ✕
                </button>
              )}
            </div>
            {d.notes && <div className="pl-1 text-xs text-slate-500">{d.notes}</div>}
          </li>
        ))}
      </ul>

      {canEdit && (
        <div className="mt-3 border-t border-ink-800 pt-3">
          <div className="label">Add a file</div>
          <div className="flex flex-wrap items-center gap-1.5">
            <select
              className="input w-40"
              value={uploadKind}
              onChange={(e) => setUploadKind(e.target.value as LoadDocumentKind)}
            >
              {UPLOAD_KINDS.map((k) => (
                <option key={k} value={k}>
                  {LOAD_DOCUMENT_KINDS[k].label}
                </option>
              ))}
            </select>
            <input
              className="input min-w-[8rem] flex-1"
              placeholder="Note (optional)"
              value={uploadNote}
              onChange={(e) => setUploadNote(e.target.value)}
            />
            <label className={`btn text-xs ${busy ? 'pointer-events-none opacity-50' : 'cursor-pointer'}`}>
              {busy === 'upload' ? 'Uploading…' : 'Choose file'}
              <input
                type="file"
                className="hidden"
                accept=".pdf,.png,.jpg,.jpeg,.tif,.tiff,.heic,.txt,.doc,.docx,.xls,.xlsx"
                onChange={(e) => void onUpload(e)}
              />
            </label>
          </div>
        </div>
      )}

      {canEdit && (
        <div className="mt-3 border-t border-ink-800 pt-3">
          <div className="mb-1 flex items-center gap-2">
            <div className="label mb-0">Carrier upload link</div>
            <button
              className="btn ml-auto text-xs"
              disabled={createLink.isPending}
              onClick={() => createLink.mutate()}
            >
              {createLink.isPending ? 'Making…' : '+ New link'}
            </button>
          </div>
          <p className="mb-1.5 text-[11px] text-slate-500">
            Send this to the carrier: they can drop the POD or their invoice here without logging in.
            Links last 14 days.
          </p>
          {liveLinks.length === 0 && <div className="text-xs text-slate-500">No link yet.</div>}
          <ul className="space-y-1">
            {liveLinks.map((l) => {
              const url = uploadPageUrl(l.token)
              const expired = Date.parse(l.expires_at) < Date.now()
              return (
                <li key={l.id} className="flex flex-wrap items-center gap-2 text-xs">
                  <code className="min-w-0 truncate rounded bg-ink-950 px-1.5 py-0.5 text-slate-300" title={url}>
                    {url.replace(/^https?:\/\//, '')}
                  </code>
                  <button className="btn text-xs" onClick={() => void copy(url, l.id)}>
                    {copied === l.id ? 'Copied' : 'Copy'}
                  </button>
                  <span className={`text-[11px] ${expired ? 'text-red-300' : 'text-slate-500'}`}>
                    {expired ? 'expired' : `expires ${relativeTime(l.expires_at)}`} · used {l.uses}×
                  </span>
                  <button
                    className="text-slate-500 hover:text-red-300"
                    title="Revoke this link"
                    onClick={() => revokeLink.mutate(l.id)}
                  >
                    ✕
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </section>
  )
}
