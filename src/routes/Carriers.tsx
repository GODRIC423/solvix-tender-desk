import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  fetchAllCarriers,
  useCarrierSearch,
  useDueCarrierFollowUps,
  useImportCarriers,
  useSaveCarrier,
} from '@/hooks/useCarriers'
import { useCarrierListSignals, type CarrierListSignal } from '@/hooks/useCarrierPerformance'
import { useAuth } from '@/hooks/useAuth'
import { useSettings } from '@/hooks/useSettings'
import CsvImport, { exportRows, type CsvColumn } from '@/components/CsvImport'
import { OpenInNewTab, ROW_LINK_CLASS, useRowLink } from '@/components/RowLink'
import { PhoneLink } from '@/components/Contact'
import { todayStamp } from '@/lib/csv'
import { relativeTime } from '@/lib/urgency'
import type { Carrier } from '@/types/db'

/**
 * The template's columns. This list IS the template: the download, the
 * validation and the column guide all read from it, and the `import_carriers`
 * RPC accepts exactly these keys.
 */
export const CARRIER_COLUMNS: CsvColumn[] = [
  { key: 'name', label: 'Carrier name', required: true, example: 'Fast Freight LLC' },
  {
    key: 'dot_number',
    label: 'DOT number',
    example: '2345678',
    help: 'Digits only. Used to match an existing carrier so re-importing updates instead of duplicating.',
  },
  { key: 'mc_number', label: 'MC number', example: '876543' },
  { key: 'scac', label: 'SCAC', example: 'FFLL' },
  { key: 'address1', label: 'Address', example: '100 Terminal Rd' },
  { key: 'address2', label: 'Address 2', example: 'Suite B' },
  { key: 'city', label: 'City', example: 'Marietta' },
  { key: 'state', label: 'State', example: 'GA', help: 'Two letters.' },
  { key: 'postal', label: 'Zip', example: '30062' },
  { key: 'dispatch_contact_name', label: 'Dispatch contact', example: 'Dana Ruiz' },
  { key: 'dispatch_contact_phone', label: 'Dispatch phone', example: '(770) 555-0142' },
  { key: 'dispatch_contact_email', label: 'Dispatch email', example: 'dispatch@fastfreight.com' },
  {
    key: 'equipment_types',
    label: 'Equipment types',
    example: 'van; reefer',
    help: 'Separate several with a semicolon.',
  },
  {
    key: 'status',
    label: 'Status',
    example: 'active',
    values: ['active', 'inactive', 'do_not_use'],
    help: 'Blank means active.',
  },
  { key: 'notes', label: 'Notes', example: 'Prefers Southeast lanes' },
]

export default function Carriers() {
  const [search, setSearch] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const { data: carriers, isLoading } = useCarrierSearch(search)
  const { data: signals } = useCarrierListSignals()
  const { data: due } = useDueCarrierFollowUps()
  const { data: settings } = useSettings()
  const { can } = useAuth()
  const importCarriers = useImportCarriers()

  const quietDays = settings?.interactionAging.recent_days ?? 30

  async function onExport() {
    setExporting(true)
    setExportError(null)
    try {
      const all = await fetchAllCarriers()
      exportRows(
        `carriers-${todayStamp()}.csv`,
        CARRIER_COLUMNS.map((c) => ({ key: c.key as keyof (typeof all)[number] & string, label: c.label })),
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
        <h1 className="text-lg font-semibold text-slate-100">Carriers</h1>
        <input
          className="input ml-auto w-80"
          placeholder="Search by DOT #, MC #, or name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoFocus
        />
        {can('import_carriers') && (
          <button className="btn" onClick={() => setShowImport((v) => !v)}>
            {showImport ? 'Close import' : 'Import'}
          </button>
        )}
        {can('export_carriers') && (
          <button className="btn" onClick={onExport} disabled={exporting} title="Download every carrier as a CSV">
            {exporting ? 'Exporting…' : 'Export'}
          </button>
        )}
        <button className="btn btn-primary" onClick={() => setShowNew((v) => !v)}>
          {showNew ? 'Cancel' : 'Add carrier'}
        </button>
      </div>

      {exportError && <div className="mb-3 text-xs text-red-300">{exportError}</div>}

      {/* Follow-ups that are due — "call them back Tuesday about the rate". */}
      {(due ?? []).length > 0 && (
        <div className="card mb-3 border-band-yellow/40 bg-band-yellow/10 p-3">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-amber-300">
            Follow-ups due
          </div>
          <ul className="space-y-1 text-sm">
            {(due ?? []).slice(0, 6).map((f) => (
              <li key={f.id} className="flex flex-wrap items-baseline gap-2">
                <Link to={`/carriers/${f.carrier_id}`} className="text-accent hover:underline">
                  {f.carrier_name}
                </Link>
                <span className="text-slate-300">{f.body}</span>
                <span className="text-xs text-slate-500">
                  {f.interaction_type_label} · due {relativeTime(f.follow_up_at ?? f.created_at)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {showImport && (
        <div className="mb-3">
          <CsvImport
            title="Import carriers"
            entity="carriers"
            columns={CARRIER_COLUMNS}
            templateFilename="carriers-template.csv"
            onImport={(rows) => importCarriers.mutateAsync(rows)}
            onDone={() => setShowImport(false)}
          />
        </div>
      )}

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
              <th className="th">Loads</th>
              <th className="th">Last activity</th>
              <th className="th">Status</th>
              <th className="th w-10" />
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
            {!isLoading && (carriers ?? []).length === 0 && (
              <tr>
                <td className="td text-slate-400" colSpan={9}>
                  No carriers yet.{can('import_carriers') ? ' Import a spreadsheet or add one.' : ''}
                </td>
              </tr>
            )}
            {(carriers ?? []).map((c) => (
              <CarrierRow key={c.id} carrier={c} signal={signals?.[c.id]} quietDays={quietDays} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function latestOf(...dates: Array<string | null | undefined>): string | null {
  let best: string | null = null
  for (const d of dates) {
    if (d && (!best || Date.parse(d) > Date.parse(best))) best = d
  }
  return best
}

/**
 * One carrier in the list. The whole row opens the profile; the name link,
 * the phone number and the ↗ keep their own behaviour inside it.
 */
function CarrierRow({
  carrier: c,
  signal,
  quietDays,
}: {
  carrier: Carrier
  signal?: CarrierListSignal
  quietDays: number
}) {
  const href = `/carriers/${c.id}`
  const link = useRowLink(href)

  const lastActivity = latestOf(signal?.last_interaction_at, signal?.last_delivered_at)
  const quiet =
    c.status === 'active' &&
    (!lastActivity || Date.now() - Date.parse(lastActivity) > quietDays * 86_400_000)
  const loadsTotal = Number(signal?.loads_total) || 0
  const trouble = (Number(signal?.service_failures) || 0) + (Number(signal?.fell_off_loads) || 0)

  return (
    <tr {...link} className={ROW_LINK_CLASS}>
      <td className="td">
        <Link to={href} className="font-medium text-accent hover:underline">
          {c.name}
        </Link>
        {(c.dispatch_contact_name || c.dispatch_contact_phone) && (
          <div className="text-xs text-slate-500">
            {c.dispatch_contact_name}
            {c.dispatch_contact_name && c.dispatch_contact_phone && ' · '}
            <PhoneLink phone={c.dispatch_contact_phone} />
          </div>
        )}
      </td>
      <td className="td font-mono text-sm">{c.dot_number ?? '—'}</td>
      <td className="td font-mono text-sm">{c.mc_number ?? '—'}</td>
      <td className="td text-sm">
        {c.city ? `${c.city}, ${c.state ?? ''}` : <span className="text-slate-500">—</span>}
      </td>
      <td className="td text-sm">{c.equipment_types?.join(', ') || '—'}</td>
      <td className="td text-sm">
        {signal ? (
          <>
            {loadsTotal}
            {trouble > 0 && (
              <span
                className="ml-1.5 rounded bg-band-red/15 px-1 text-[10px] uppercase text-red-300"
                title={`${trouble} service failure(s) or dropped load(s) on record`}
              >
                {trouble} issue{trouble === 1 ? '' : 's'}
              </span>
            )}
          </>
        ) : (
          <span className="text-slate-500">—</span>
        )}
      </td>
      <td className="td text-sm">
        <span className={quiet ? 'text-slate-500' : 'text-slate-200'}>
          {lastActivity ? relativeTime(lastActivity) : 'never'}
        </span>
        {quiet && (
          <span
            className="ml-1.5 rounded bg-band-yellow/15 px-1 text-[10px] uppercase text-amber-300"
            title={`Nothing logged or delivered in ${quietDays} days`}
          >
            quiet
          </span>
        )}
      </td>
      <td className="td">
        <StatusPill status={c.status} />
      </td>
      <td className="td text-right">
        <OpenInNewTab href={href} what="carrier" />
      </td>
    </tr>
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
