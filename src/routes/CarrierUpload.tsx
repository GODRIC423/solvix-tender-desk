import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { LOAD_DOCUMENT_KINDS } from '@/lib/documents/data'
import type { LoadDocumentKind } from '@/types/db'

/**
 * The page a carrier lands on from an upload link. No login: the token in the
 * URL is checked by the upload-document Edge Function, which does the writes.
 */

interface LinkInfo {
  load: {
    load_number: string
    shipment_id: string | null
    origin_city: string | null
    origin_state: string | null
    dest_city: string | null
    dest_state: string | null
    carrier_name: string | null
  }
  expires_at: string
  kinds: string[]
}

const ENDPOINT = `${(import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? ''}/functions/v1/upload-document`
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

function headers(json = false): Record<string, string> {
  const h: Record<string, string> = {}
  if (ANON_KEY) h.apikey = ANON_KEY
  if (json) h['content-type'] = 'application/json'
  return h
}

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file'))
    reader.readAsDataURL(file)
  })
}

export default function CarrierUpload() {
  const { token } = useParams<{ token: string }>()
  const [info, setInfo] = useState<LinkInfo | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'invalid' | 'sending'>('loading')
  const [message, setMessage] = useState<string | null>(null)
  const [kind, setKind] = useState<LoadDocumentKind>('pod')
  const [file, setFile] = useState<File | null>(null)
  const [note, setNote] = useState('')
  const [done, setDone] = useState<string[]>([])

  useEffect(() => {
    let cancelled = false
    fetch(`${ENDPOINT}?token=${encodeURIComponent(token ?? '')}`, { headers: headers() })
      .then(async (r) => (await r.json()) as { ok: boolean; error?: string } & Partial<LinkInfo>)
      .then((j) => {
        if (cancelled) return
        if (j.ok && j.load) {
          setInfo(j as LinkInfo)
          setState('ready')
        } else {
          setMessage(j.error ?? 'This link is not valid.')
          setState('invalid')
        }
      })
      .catch(() => {
        if (cancelled) return
        setMessage('Could not reach the server. Try again in a moment.')
        setState('invalid')
      })
    return () => {
      cancelled = true
    }
  }, [token])

  async function submit() {
    if (!file || !token) return
    setState('sending')
    setMessage(null)
    try {
      const data_base64 = await toBase64(file)
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: headers(true),
        body: JSON.stringify({ token, kind, file_name: file.name, content_type: file.type, data_base64, notes: note }),
      })
      const j = (await res.json()) as { ok: boolean; error?: string; file_name?: string }
      if (j.ok) {
        setDone((d) => [...d, j.file_name ?? file.name])
        setFile(null)
        setNote('')
      } else {
        setMessage(j.error ?? 'The upload failed.')
      }
    } catch {
      setMessage('The upload failed. Check your connection and try again.')
    } finally {
      setState('ready')
    }
  }

  const kinds = (info?.kinds ?? ['pod', 'carrier_invoice', 'lumper_receipt', 'scale_ticket', 'other']) as LoadDocumentKind[]
  const load = info?.load

  return (
    <div className="mx-auto max-w-lg p-4 sm:py-10">
      <div className="card p-5">
        <div className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">Document upload</div>
        {state === 'loading' && <p className="text-sm text-slate-400">Checking your link…</p>}

        {state === 'invalid' && (
          <>
            <h1 className="mb-2 text-lg font-semibold text-slate-100">This link can&apos;t be used</h1>
            <p className="text-sm text-slate-300">{message}</p>
          </>
        )}

        {(state === 'ready' || state === 'sending') && load && (
          <>
            <h1 className="mb-1 text-lg font-semibold text-slate-100">Load {load.load_number}</h1>
            <p className="mb-4 text-sm text-slate-400">
              {load.origin_city ? `${load.origin_city}, ${load.origin_state ?? ''} → ${load.dest_city ?? '?'}, ${load.dest_state ?? ''}` : ''}
              {load.carrier_name ? ` · ${load.carrier_name}` : ''}
              {load.shipment_id ? ` · Ref ${load.shipment_id}` : ''}
            </p>

            {done.length > 0 && (
              <div className="mb-4 rounded border border-band-green/40 bg-band-green/10 p-3 text-sm text-emerald-300">
                Received: {done.join(', ')}. You can send another file below.
              </div>
            )}
            {message && <div className="mb-3 text-sm text-red-300">{message}</div>}

            <div className="space-y-3">
              <div>
                <label className="label">What is this?</label>
                <select className="input" value={kind} onChange={(e) => setKind(e.target.value as LoadDocumentKind)}>
                  {kinds.map((k) => (
                    <option key={k} value={k}>
                      {LOAD_DOCUMENT_KINDS[k]?.label ?? k}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">File (PDF or photo, up to 25 MB)</label>
                <input
                  className="input"
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg,.tif,.tiff,.heic,image/*,application/pdf"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
              </div>
              <div>
                <label className="label">Note (optional)</label>
                <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. signed POD, page 2 of 2" />
              </div>
              <button className="btn btn-primary w-full justify-center" disabled={!file || state === 'sending'} onClick={() => void submit()}>
                {state === 'sending' ? 'Sending…' : 'Send'}
              </button>
              <p className="text-[11px] text-slate-500">
                This link expires {new Date(info!.expires_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
