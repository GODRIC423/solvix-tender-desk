import { useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import {
  openStoredFile,
  useCarrierDocuments,
  useCarrierInsurance,
  useDeleteInsurance,
  useSaveInsurance,
  type InsuranceInput,
} from '@/hooks/useDocuments'
import { INSURANCE_COVERAGES, fmtDate, money, policyHealth } from '@/lib/documents/data'
import { exportRows } from '@/components/CsvImport'
import { todayStamp } from '@/lib/csv'
import type { Carrier, CarrierInsurance, InsuranceCoverage } from '@/types/db'

function blank(): InsuranceInput {
  return {
    coverage: 'auto_liability',
    insurer: null,
    policy_number: null,
    coverage_amount: null,
    deductible: null,
    effective_at: null,
    expires_at: null,
    certificate_document_id: null,
    agent_name: null,
    agent_phone: null,
    agent_email: null,
    notes: null,
  }
}

const HEALTH_CLASS = {
  expired: 'border-band-red/40 bg-band-red/15 text-red-300',
  expiring: 'border-band-yellow/40 bg-band-yellow/15 text-amber-300',
  ok: 'border-band-green/40 bg-band-green/15 text-emerald-300',
  no_date: 'border-ink-600 bg-ink-800 text-slate-400',
} as const

/** Their policies, with the dates that decide whether we can book them. */
export default function CarrierInsuranceTab({ carrier }: { carrier: Carrier }) {
  const { can } = useAuth()
  const canEdit = can('edit_loads')
  const { data: policies } = useCarrierInsurance(carrier.id)
  const { data: docs } = useCarrierDocuments(carrier.id)
  const save = useSaveInsurance(carrier.id)
  const del = useDeleteInsurance(carrier.id)
  const [editing, setEditing] = useState<InsuranceInput | null>(null)

  const certificates = (docs ?? []).filter((d) => d.kind === 'insurance_certificate')

  function startEdit(p: CarrierInsurance) {
    setEditing({
      id: p.id,
      coverage: p.coverage,
      insurer: p.insurer,
      policy_number: p.policy_number,
      coverage_amount: p.coverage_amount,
      deductible: p.deductible,
      effective_at: p.effective_at,
      expires_at: p.expires_at,
      certificate_document_id: p.certificate_document_id,
      agent_name: p.agent_name,
      agent_phone: p.agent_phone,
      agent_email: p.agent_email,
      notes: p.notes,
    })
  }

  function exportCsv() {
    const slug = carrier.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'carrier'
    exportRows(
      `${slug}-insurance-${todayStamp()}.csv`,
      [
        { key: 'coverage', label: 'Coverage' },
        { key: 'insurer', label: 'Insurer' },
        { key: 'policy_number', label: 'Policy #' },
        { key: 'coverage_amount', label: 'Limit' },
        { key: 'deductible', label: 'Deductible' },
        { key: 'effective_at', label: 'Effective' },
        { key: 'expires_at', label: 'Expires' },
        { key: 'status', label: 'Status' },
        { key: 'agent_name', label: 'Agent' },
        { key: 'agent_phone', label: 'Agent phone' },
        { key: 'agent_email', label: 'Agent email' },
        { key: 'notes', label: 'Notes' },
      ],
      (policies ?? []).map((p) => ({
        coverage: INSURANCE_COVERAGES[p.coverage],
        insurer: p.insurer ?? '',
        policy_number: p.policy_number ?? '',
        coverage_amount: p.coverage_amount ?? '',
        deductible: p.deductible ?? '',
        effective_at: p.effective_at ?? '',
        expires_at: p.expires_at ?? '',
        status: policyHealth(p.expires_at).replace('_', ' '),
        agent_name: p.agent_name ?? '',
        agent_phone: p.agent_phone ?? '',
        agent_email: p.agent_email ?? '',
        notes: p.notes ?? '',
      })),
    )
  }

  const e = editing
  const set = (patch: Partial<InsuranceInput>) => setEditing((cur) => (cur ? { ...cur, ...patch } : cur))
  const text = (k: keyof InsuranceInput) => (ev: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    set({ [k]: ev.target.value === '' ? null : ev.target.value } as Partial<InsuranceInput>)
  const num = (k: 'coverage_amount' | 'deductible') => (ev: React.ChangeEvent<HTMLInputElement>) =>
    set({ [k]: ev.target.value === '' ? null : Number(ev.target.value) })

  return (
    <div className="space-y-4">
      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-ink-700 p-3">
          <h2 className="text-sm font-semibold text-slate-200">Insurance</h2>
          <span className="text-xs text-slate-500">
            {(policies ?? []).length} polic{(policies ?? []).length === 1 ? 'y' : 'ies'}
          </span>
          <div className="ml-auto flex gap-1.5">
            {(policies ?? []).length > 0 && (
              <button className="btn text-xs" onClick={exportCsv}>
                Export CSV
              </button>
            )}
            {canEdit && !editing && (
              <button className="btn btn-primary text-xs" onClick={() => setEditing(blank())}>
                + Add policy
              </button>
            )}
          </div>
        </div>
        <table className="w-full border-collapse">
          <thead className="border-b border-ink-700 bg-ink-850">
            <tr>
              <th className="th">Coverage</th>
              <th className="th">Insurer</th>
              <th className="th">Policy #</th>
              <th className="th">Limit</th>
              <th className="th">Effective</th>
              <th className="th">Expires</th>
              <th className="th">Certificate</th>
              <th className="th w-20" />
            </tr>
          </thead>
          <tbody>
            {(policies ?? []).length === 0 && (
              <tr>
                <td className="td text-slate-400" colSpan={8}>
                  No policies recorded. Add their auto liability and cargo coverage from the certificate
                  of insurance.
                </td>
              </tr>
            )}
            {(policies ?? []).map((p) => {
              const health = policyHealth(p.expires_at)
              const cert = certificates.find((c) => c.id === p.certificate_document_id)
              return (
                <tr key={p.id} className="border-b border-ink-800">
                  <td className="td text-sm">{INSURANCE_COVERAGES[p.coverage]}</td>
                  <td className="td text-sm">{p.insurer ?? '—'}</td>
                  <td className="td font-mono text-sm">{p.policy_number ?? '—'}</td>
                  <td className="td text-sm">{money(p.coverage_amount)}</td>
                  <td className="td text-sm">{fmtDate(p.effective_at)}</td>
                  <td className="td text-sm">
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${HEALTH_CLASS[health]}`}>
                      {health === 'no_date' ? 'no date' : health === 'expired' ? `expired ${fmtDate(p.expires_at)}` : fmtDate(p.expires_at)}
                    </span>
                  </td>
                  <td className="td text-sm">
                    {cert ? (
                      <button
                        className="text-accent hover:underline"
                        onClick={() => void openStoredFile('carrier-documents', cert.storage_path)}
                      >
                        {cert.file_name}
                      </button>
                    ) : (
                      <span className="text-slate-500">—</span>
                    )}
                  </td>
                  <td className="td text-right">
                    {canEdit && (
                      <>
                        <button className="text-xs text-slate-400 hover:text-accent" onClick={() => startEdit(p)}>
                          Edit
                        </button>
                        <button
                          className="ml-2 text-xs text-slate-500 hover:text-red-300"
                          onClick={() => {
                            if (window.confirm('Remove this policy?')) del.mutate(p.id)
                          }}
                        >
                          ✕
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </section>

      {e && (
        <section className="card p-3">
          <h2 className="mb-2 text-sm font-semibold text-slate-200">{e.id ? 'Edit policy' : 'New policy'}</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="label">Coverage</label>
              <select className="input" value={e.coverage} onChange={(ev) => set({ coverage: ev.target.value as InsuranceCoverage })}>
                {(Object.keys(INSURANCE_COVERAGES) as InsuranceCoverage[]).map((k) => (
                  <option key={k} value={k}>
                    {INSURANCE_COVERAGES[k]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Insurer</label>
              <input className="input" value={e.insurer ?? ''} onChange={text('insurer')} />
            </div>
            <div>
              <label className="label">Policy #</label>
              <input className="input" value={e.policy_number ?? ''} onChange={text('policy_number')} />
            </div>
            <div>
              <label className="label">Limit ($)</label>
              <input className="input" type="number" min="0" step="1000" value={e.coverage_amount ?? ''} onChange={num('coverage_amount')} />
            </div>
            <div>
              <label className="label">Deductible ($)</label>
              <input className="input" type="number" min="0" step="100" value={e.deductible ?? ''} onChange={num('deductible')} />
            </div>
            <div>
              <label className="label">Effective</label>
              <input className="input" type="date" value={e.effective_at ?? ''} onChange={text('effective_at')} />
            </div>
            <div>
              <label className="label">Expires</label>
              <input className="input" type="date" value={e.expires_at ?? ''} onChange={text('expires_at')} />
            </div>
            <div>
              <label className="label">Certificate</label>
              <select
                className="input"
                value={e.certificate_document_id ?? ''}
                onChange={(ev) => set({ certificate_document_id: ev.target.value || null })}
              >
                <option value="">— none linked —</option>
                {certificates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.file_name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Agent</label>
              <input className="input" value={e.agent_name ?? ''} onChange={text('agent_name')} />
            </div>
            <div>
              <label className="label">Agent phone</label>
              <input className="input" value={e.agent_phone ?? ''} onChange={text('agent_phone')} />
            </div>
            <div>
              <label className="label">Agent email</label>
              <input className="input" value={e.agent_email ?? ''} onChange={text('agent_email')} />
            </div>
            <div className="sm:col-span-2 lg:col-span-4">
              <label className="label">Notes</label>
              <input className="input" value={e.notes ?? ''} onChange={text('notes')} />
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <button
              className="btn btn-primary"
              disabled={save.isPending}
              onClick={() => save.mutate(e, { onSuccess: () => setEditing(null) })}
            >
              {save.isPending ? 'Saving…' : 'Save policy'}
            </button>
            <button className="btn" onClick={() => setEditing(null)}>
              Cancel
            </button>
            {save.error && <span className="text-xs text-red-300">{(save.error as Error).message}</span>}
          </div>
        </section>
      )}
    </div>
  )
}
