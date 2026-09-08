import React, { useCallback, useMemo, useState } from 'react'
import ReactDOM from 'react-dom/client'
import { extractFromFile, type ExtractionResult } from '@/lib/extract-tender'
import { LOAD_FIELD_GROUPS, fieldAt } from '@/lib/load-fields'
import { BandPill, QcScoreBadge } from '@/components/BandPill'
import { bandFor } from '@/lib/qc-bands'
import '@/index.css'

/**
 * The standalone connector.
 *
 * Deliberately its own page, not a tab inside the TMS: someone submitting
 * tenders should be able to open one file, drop a PDF, and be done — without a
 * dispatcher login. Everything up to "Send to TMS" runs entirely in this
 * browser (pdf.js + Tesseract, same as the original tool), so a tender that is
 * never sent never leaves the machine.
 */

const INGEST_ENDPOINT = import.meta.env.VITE_INGEST_ENDPOINT ?? ''

type SendState =
  | { status: 'idle' }
  | { status: 'sending' }
  | { status: 'sent'; loadNumber: string; loadId: string }
  | { status: 'error'; message: string }

function Connector() {
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<{ msg: string; pct: number } | null>(null)
  const [result, setResult] = useState<ExtractionResult | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [sourceFile, setSourceFile] = useState<File | null>(null)
  const [send, setSend] = useState<SendState>({ status: 'idle' })
  const [token, setToken] = useState(() => localStorage.getItem('solvix.ingestToken') ?? '')
  const [dragging, setDragging] = useState(false)

  const handleFile = useCallback(async (file: File) => {
    setBusy(true)
    setResult(null)
    setSend({ status: 'idle' })
    setFileName(file.name)
    setSourceFile(file)
    try {
      const res = await extractFromFile(file, (msg, pct) => setProgress({ msg, pct }))
      setResult(res)
    } catch (err) {
      setSend({ status: 'error', message: `Couldn't read that file: ${(err as Error).message}` })
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }, [])

  const lowConfidence = useMemo(() => {
    if (!result) return []
    return LOAD_FIELD_GROUPS.flatMap((g) => g.fields)
      .map((f) => ({ f, field: fieldAt(result.tender, f.path) }))
      .filter((x) => x.field && bandFor(x.field.c) !== 'green')
  }, [result])

  async function sendToTms() {
    if (!result || !sourceFile) return
    if (!INGEST_ENDPOINT) {
      setSend({
        status: 'error',
        message: 'No ingest endpoint configured. Set VITE_INGEST_ENDPOINT and rebuild — see DEPLOY.md.',
      })
      return
    }
    setSend({ status: 'sending' })
    try {
      const base64 = await fileToBase64(sourceFile)
      const res = await fetch(INGEST_ENDPOINT, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(token ? { 'x-ingest-token': token } : {}),
        },
        body: JSON.stringify({
          tender: result.tender,
          source_file_name: fileName,
          source_file_base64: base64,
          source_kind: result.kind,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || !body?.ok) {
        throw new Error(body?.error ?? `Ingest failed (${res.status})`)
      }
      localStorage.setItem('solvix.ingestToken', token)
      setSend({ status: 'sent', loadNumber: body.load_number, loadId: body.load_id })
    } catch (err) {
      setSend({ status: 'error', message: (err as Error).message })
    }
  }

  return (
    <div className="mx-auto max-w-5xl p-6">
      <header className="mb-6 flex items-baseline gap-3">
        <h1 className="text-lg font-semibold text-slate-100">Drop a load tender</h1>
        <span className="text-xs text-slate-400">
          Reads the document in your browser, then sends the load to the desk.
        </span>
      </header>

      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          const file = e.dataTransfer.files?.[0]
          if (file) void handleFile(file)
        }}
        className={`card flex flex-col items-center justify-center gap-2 border-2 border-dashed p-10 text-center transition ${
          dragging ? 'border-accent bg-accent/5' : 'border-ink-600'
        }`}
      >
        <p className="text-sm text-slate-300">
          Drop a tender here — PDF, scan, photo, .eml or .txt
        </p>
        <label className="btn btn-primary cursor-pointer">
          Choose a file
          <input
            type="file"
            className="hidden"
            accept=".pdf,.png,.jpg,.jpeg,.tif,.tiff,.webp,.txt,.eml"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void handleFile(file)
            }}
          />
        </label>
        {fileName && <p className="text-xs text-slate-500">{fileName}</p>}
      </div>

      {busy && (
        <div className="card mt-4 p-4">
          <p className="text-sm text-slate-300">{progress?.msg ?? 'Reading…'}</p>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded bg-ink-800">
            <div
              className="h-full bg-accent transition-all"
              style={{ width: `${Math.round((progress?.pct ?? 0) * 100)}%` }}
            />
          </div>
        </div>
      )}

      {result && (
        <>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <QcScoreBadge score={result.score} />
            <span className="text-xs text-slate-400">
              {result.tender.stops.length} stop{result.tender.stops.length === 1 ? '' : 's'} ·{' '}
              {result.pages.length} page{result.pages.length === 1 ? '' : 's'} · read via{' '}
              {result.kind}
            </span>

            <div className="ml-auto flex items-center gap-2">
              <input
                className="input w-56"
                type="password"
                placeholder="Ingest token"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                title="Given to you by an admin. Stored in this browser only."
              />
              <button
                className="btn btn-primary"
                onClick={() => void sendToTms()}
                disabled={send.status === 'sending'}
              >
                {send.status === 'sending' ? 'Sending…' : 'Send to TMS'}
              </button>
            </div>
          </div>

          {send.status === 'sent' && (
            <div className="card mt-3 border-band-green/40 bg-band-green/10 p-3 text-sm text-emerald-300">
              Created load <strong>{send.loadNumber}</strong>. It&apos;s on the board in QC Review.
            </div>
          )}
          {send.status === 'error' && (
            <div className="card mt-3 border-band-red/40 bg-band-red/10 p-3 text-sm text-red-300">
              {send.message}
            </div>
          )}

          {result.tender.warnings.length > 0 && (
            <ul className="card mt-3 space-y-1 p-3">
              {result.tender.warnings.map((w, i) => (
                <li key={i} className="text-xs text-amber-300">
                  ⚠ {w}
                </li>
              ))}
            </ul>
          )}

          {lowConfidence.length > 0 && (
            <div className="card mt-3 border-band-orange/40 bg-band-orange/5 p-3">
              <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-orange-300">
                {lowConfidence.length} field{lowConfidence.length === 1 ? '' : 's'} the desk should
                verify
              </div>
              <div className="flex flex-wrap gap-1.5">
                {lowConfidence.map(({ f, field }) => (
                  <span
                    key={f.key}
                    className="inline-flex items-center gap-1.5 rounded border border-ink-600 bg-ink-850 px-2 py-0.5 text-xs"
                  >
                    {f.label}
                    <BandPill confidence={field!.c} />
                  </span>
                ))}
              </div>
            </div>
          )}

          <section className="card mt-4 p-3">
            <h2 className="mb-2 text-sm font-semibold text-slate-200">What we read</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              {LOAD_FIELD_GROUPS.map((group) => (
                <div key={group.title}>
                  <div className="label">{group.title}</div>
                  <ul className="space-y-1">
                    {group.fields.map((f) => {
                      const field = fieldAt(result.tender, f.path)
                      if (!field || field.v === null || field.v === '') return null
                      return (
                        <li key={f.key} className="flex items-center justify-between gap-2 text-sm">
                          <span className="text-slate-400">{f.label}</span>
                          <span className="flex items-center gap-2">
                            <span className="text-slate-200">{String(field.v)}</span>
                            <BandPill confidence={field.c} />
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              ))}
            </div>
          </section>

          <section className="card mt-4 p-3">
            <h2 className="mb-2 text-sm font-semibold text-slate-200">Stops</h2>
            <div className="space-y-2">
              {result.tender.stops.map((stop, i) => (
                <div key={i} className="rounded border border-ink-700 bg-ink-850 p-2 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-ink-800 px-1.5 py-0.5 text-[10px] uppercase text-slate-300">
                      {String(stop.stop_type.v ?? 'stop')}
                    </span>
                    <span className="text-slate-200">{String(stop.party.name.v ?? '—')}</span>
                    <BandPill confidence={stop.party.name.c} className="ml-auto" />
                  </div>
                  <div className="mt-1 text-xs text-slate-400">
                    {String(stop.party.city.v ?? '—')}, {String(stop.party.state.v ?? '')}{' '}
                    {String(stop.party.postal.v ?? '')} · {String(stop.earliest.v ?? 'no window')}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  )
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const out = String(reader.result ?? '')
      // strip the data: URL prefix — the function wants raw base64
      resolve(out.slice(out.indexOf(',') + 1))
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

ReactDOM.createRoot(document.getElementById('connector-root')!).render(
  <React.StrictMode>
    <Connector />
  </React.StrictMode>,
)
