import { useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { logoUrl, useSettings } from '@/hooks/useSettings'
import {
  downloadBlob,
  openStoredFile,
  useAddCarrierDocument,
  useCarrierDocuments,
  useDeleteCarrierDocument,
} from '@/hooks/useDocuments'
import { CARRIER_DOCUMENT_KINDS, fileSize, fmtDate, policyHealth } from '@/lib/documents/data'
import { relativeTime } from '@/lib/urgency'
import type { Carrier, CarrierDocumentKind } from '@/types/db'

/** The carrier's paperwork: the agreement we generate, and what they send us. */
export default function CarrierDocumentsTab({ carrier }: { carrier: Carrier }) {
  const { can, isAdmin } = useAuth()
  const canEdit = can('edit_loads')
  const { data: settings } = useSettings()
  const { data: docs } = useCarrierDocuments(carrier.id)
  const add = useAddCarrierDocument(carrier.id)
  const del = useDeleteCarrierDocument(carrier.id)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [kind, setKind] = useState<CarrierDocumentKind>('insurance_certificate')
  const [signedAt, setSignedAt] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [notes, setNotes] = useState('')

  async function generateAgreement() {
    if (!settings) return
    setBusy(true)
    setError(null)
    try {
      const { generateCarrierAgreement } = await import('@/lib/documents')
      const file = await generateCarrierAgreement({
        company: settings.company,
        logoUrl: logoUrl(settings.company.logo_path),
        carrier,
      })
      await add.mutateAsync({
        file: file.blob,
        fileName: file.fileName,
        kind: 'broker_carrier_agreement',
        notes: 'Generated — unsigned. Upload the signed copy when it comes back.',
        contentType: 'application/pdf',
      })
      downloadBlob(file.blob, file.fileName)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      await add.mutateAsync({
        file,
        fileName: file.name,
        kind,
        signedAt: signedAt || null,
        expiresAt: expiresAt || null,
        notes: notes.trim() || null,
        contentType: file.type || undefined,
      })
      setSignedAt('')
      setExpiresAt('')
      setNotes('')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <section className="card p-3 lg:col-span-2">
        <h2 className="mb-2 text-sm font-semibold text-slate-200">On file</h2>
        {error && <div className="mb-2 text-xs text-red-300">{error}</div>}
        {(docs ?? []).length === 0 && (
          <p className="text-xs text-slate-500">
            Nothing yet. Generate the agreement, then upload the signed copy, their certificate of
            insurance, W-9 and authority as they come in.
          </p>
        )}
        <ul className="space-y-2">
          {(docs ?? []).map((d) => {
            const health = policyHealth(d.expires_at)
            return (
              <li key={d.id} className="text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded bg-ink-700 px-1.5 py-0.5 text-[10px] uppercase text-slate-300">
                    {CARRIER_DOCUMENT_KINDS[d.kind]}
                  </span>
                  <button
                    className="min-w-0 truncate text-left text-slate-200 hover:text-accent hover:underline"
                    title="Open"
                    onClick={() =>
                      openStoredFile('carrier-documents', d.storage_path).catch((e) => setError((e as Error).message))
                    }
                  >
                    {d.file_name}
                  </button>
                  {d.signed_at && <span className="text-[11px] text-slate-500">signed {fmtDate(d.signed_at)}</span>}
                  {d.expires_at && (
                    <span
                      className={`text-[11px] ${
                        health === 'expired' ? 'text-red-300' : health === 'expiring' ? 'text-amber-300' : 'text-slate-500'
                      }`}
                    >
                      {health === 'expired' ? 'expired' : 'expires'} {fmtDate(d.expires_at)}
                    </span>
                  )}
                  <span className="ml-auto text-[11px] text-slate-500">
                    {fileSize(d.size_bytes)} · {relativeTime(d.created_at)}
                  </span>
                  {isAdmin && (
                    <button
                      className="text-xs text-slate-500 hover:text-red-300"
                      title="Delete"
                      onClick={() => {
                        if (window.confirm(`Delete ${d.file_name}?`)) del.mutate(d)
                      }}
                    >
                      ✕
                    </button>
                  )}
                </div>
                {d.notes && <div className="pl-1 text-xs text-slate-500">{d.notes}</div>}
              </li>
            )
          })}
        </ul>
      </section>

      <div className="space-y-4">
        {canEdit && (
          <section className="card p-3">
            <h2 className="mb-1 text-sm font-semibold text-slate-200">Broker-carrier agreement</h2>
            <p className="mb-2 text-xs text-slate-500">
              Built from the text under Settings → Company &amp; documents, filled in for {carrier.name}.
            </p>
            <button className="btn btn-primary w-full justify-center" disabled={busy} onClick={() => void generateAgreement()}>
              {busy ? 'Working…' : 'Generate agreement'}
            </button>
          </section>
        )}

        {canEdit && (
          <section className="card p-3">
            <h2 className="mb-2 text-sm font-semibold text-slate-200">Upload a document</h2>
            <div className="space-y-2">
              <select className="input" value={kind} onChange={(e) => setKind(e.target.value as CarrierDocumentKind)}>
                {(Object.keys(CARRIER_DOCUMENT_KINDS) as CarrierDocumentKind[]).map((k) => (
                  <option key={k} value={k}>
                    {CARRIER_DOCUMENT_KINDS[k]}
                  </option>
                ))}
              </select>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="label">Signed</label>
                  <input className="input" type="date" value={signedAt} onChange={(e) => setSignedAt(e.target.value)} />
                </div>
                <div>
                  <label className="label">Expires</label>
                  <input className="input" type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
                </div>
              </div>
              <input className="input" placeholder="Note (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
              <label className={`btn w-full justify-center text-xs ${busy ? 'pointer-events-none opacity-50' : 'cursor-pointer'}`}>
                {busy ? 'Working…' : 'Choose file'}
                <input
                  type="file"
                  className="hidden"
                  accept=".pdf,.png,.jpg,.jpeg,.tif,.tiff,.heic,.txt,.doc,.docx,.xls,.xlsx"
                  onChange={(e) => void onUpload(e)}
                />
              </label>
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
