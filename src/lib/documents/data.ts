import type {
  CarrierDocumentKind,
  CarrierInsuranceStatus,
  InsuranceCoverage,
  Load,
  LoadCharge,
  LoadDocumentKind,
  LoadReference,
} from '@/types/db'

/**
 * The pure half of documents & billing: what the kinds are called, how a
 * load turns into invoice lines and carrier pay, how files are named and
 * versioned, and whether a carrier's insurance is in date. No PDF code here
 * so all of it is unit-testable.
 */

export const LOAD_DOCUMENT_KINDS: Record<LoadDocumentKind, { label: string; generated: boolean }> = {
  rate_confirmation: { label: 'Rate confirmation', generated: true },
  bol: { label: 'Bill of lading', generated: true },
  load_sheet: { label: 'Load sheet', generated: true },
  invoice: { label: 'Invoice', generated: true },
  pod: { label: 'Proof of delivery', generated: false },
  carrier_invoice: { label: 'Carrier invoice', generated: false },
  lumper_receipt: { label: 'Lumper receipt', generated: false },
  scale_ticket: { label: 'Scale ticket', generated: false },
  other: { label: 'Other', generated: false },
}

/** What people (and carriers, through a link) upload — never the generated kinds. */
export const UPLOAD_KINDS = (Object.keys(LOAD_DOCUMENT_KINDS) as LoadDocumentKind[]).filter(
  (k) => !LOAD_DOCUMENT_KINDS[k].generated,
)

export const CARRIER_DOCUMENT_KINDS: Record<CarrierDocumentKind, string> = {
  broker_carrier_agreement: 'Broker-carrier agreement',
  insurance_certificate: 'Insurance certificate',
  w9: 'W-9',
  authority: 'Operating authority',
  other: 'Other',
}

export const INSURANCE_COVERAGES: Record<InsuranceCoverage, string> = {
  auto_liability: 'Auto liability',
  cargo: 'Cargo',
  general_liability: 'General liability',
  workers_comp: "Workers' comp",
  other: 'Other',
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

/** S2600012-rate-confirmation.pdf, then -v2, -v3 as it is regenerated. */
export function documentFileName(kind: string, loadNumber: string, version: number): string {
  const suffix = version > 1 ? `-v${version}` : ''
  return `${loadNumber}-${kind.replace(/_/g, '-')}${suffix}.pdf`
}

export function nextVersion(existing: Array<{ kind: string; version: number }>, kind: string): number {
  return existing.filter((d) => d.kind === kind).reduce((max, d) => Math.max(max, d.version), 0) + 1
}

export function fileSize(bytes: number | null | undefined): string {
  if (bytes == null) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// ---------------------------------------------------------------------------
// Money lines
// ---------------------------------------------------------------------------

export interface LineDraft {
  description: string
  quantity: number
  rate: number | null
  amount: number
}

type ChargeLike = Pick<LoadCharge, 'side' | 'description' | 'accessorial_code' | 'quantity' | 'rate' | 'amount'>
type LaneLike = Pick<Load, 'origin_city' | 'origin_state' | 'dest_city' | 'dest_state'>

function chargeAmount(c: ChargeLike): number | null {
  if (c.amount != null) return round2(Number(c.amount))
  if (c.quantity != null && c.rate != null) return round2(Number(c.quantity) * Number(c.rate))
  if (c.rate != null) return round2(Number(c.rate))
  return null
}

export function laneText(load: LaneLike): string {
  const end = (city: string | null, state: string | null) =>
    city ? [city, state].filter(Boolean).join(', ') : null
  return [end(load.origin_city, load.origin_state), end(load.dest_city, load.dest_state)]
    .filter(Boolean)
    .join(' → ')
}

function linesFor(
  baseRate: number | null,
  baseLabel: string,
  lane: string,
  charges: ChargeLike[],
  side: 'customer' | 'carrier',
): LineDraft[] {
  const lines: LineDraft[] = []
  if (baseRate != null) {
    const amount = round2(Number(baseRate))
    lines.push({ description: lane ? `${baseLabel} — ${lane}` : baseLabel, quantity: 1, rate: amount, amount })
  }
  for (const c of charges) {
    if (c.side !== side) continue
    const amount = chargeAmount(c)
    if (amount == null) continue
    lines.push({
      description: c.description?.trim() || c.accessorial_code?.trim() || 'Accessorial',
      quantity: c.quantity != null ? Number(c.quantity) : 1,
      rate: c.rate != null ? Number(c.rate) : null,
      amount,
    })
  }
  return lines
}

/** What we bill the customer: the customer rate as linehaul, plus customer-side charges. */
export function invoiceLinesForLoad(
  load: LaneLike & Pick<Load, 'customer_rate'>,
  charges: ChargeLike[],
): LineDraft[] {
  return linesFor(load.customer_rate, 'Linehaul', laneText(load), charges, 'customer')
}

/** What we pay the carrier: the carrier rate as linehaul, plus carrier-side charges. */
export function carrierPayLinesForLoad(
  load: LaneLike & Pick<Load, 'carrier_rate'>,
  charges: ChargeLike[],
): LineDraft[] {
  return linesFor(load.carrier_rate, 'Linehaul', laneText(load), charges, 'carrier')
}

export function sumLines(lines: Array<Pick<LineDraft, 'amount'>>): number {
  return round2(lines.reduce((s, l) => s + Number(l.amount), 0))
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/** YYYY-MM-DD in local time — what a <input type="date"> and a date column want. */
export function toIsoDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** issued + terms, e.g. 2026-09-30 + 30 → 2026-10-30. */
export function dueDate(issuedIso: string, termsDays: number): string {
  const [y, m, d] = issuedIso.split('-').map(Number)
  return toIsoDate(new Date(y, m - 1, d + termsDays))
}

// ---------------------------------------------------------------------------
// Insurance
// ---------------------------------------------------------------------------

export type InsuranceHealth = 'none' | 'expired' | 'expiring' | 'ok'

export function insuranceHealth(
  s: Pick<CarrierInsuranceStatus, 'policies' | 'expired' | 'expiring_30d'> | null | undefined,
): InsuranceHealth {
  if (!s || Number(s.policies) === 0) return 'none'
  if (Number(s.expired) > 0) return 'expired'
  if (Number(s.expiring_30d) > 0) return 'expiring'
  return 'ok'
}

export type PolicyHealth = 'expired' | 'expiring' | 'ok' | 'no_date'

export function policyHealth(expiresAt: string | null, now: Date = new Date(), windowDays = 30): PolicyHealth {
  if (!expiresAt) return 'no_date'
  const [y, m, d] = expiresAt.slice(0, 10).split('-').map(Number)
  const end = new Date(y, m - 1, d, 23, 59, 59)
  const ms = end.getTime() - now.getTime()
  if (ms < 0) return 'expired'
  if (ms < windowDays * 86_400_000) return 'expiring'
  return 'ok'
}

// ---------------------------------------------------------------------------
// Formatting for print
// ---------------------------------------------------------------------------

export function money(n: number | null | undefined, currency = 'USD'): string {
  if (n == null || !Number.isFinite(Number(n))) return '—'
  return Number(n).toLocaleString('en-US', { style: 'currency', currency })
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = iso.length === 10 ? new Date(`${iso}T00:00:00`) : new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function withZone(tz: string | null | undefined): { timeZone?: string } {
  if (!tz) return {}
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return { timeZone: tz }
  } catch {
    return {}
  }
}

export function fmtDateTime(iso: string | null | undefined, tz?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('en-US', {
    ...withZone(tz),
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function fmtTime(iso: string, tz?: string | null): string {
  return new Date(iso).toLocaleTimeString('en-US', { ...withZone(tz), hour: 'numeric', minute: '2-digit' })
}

/** "Sep 15, 8:00 AM – 12:00 PM", or both ends in full when they fall on different days. */
export function fmtWindow(earliest: string | null, latest: string | null, tz?: string | null): string {
  if (!earliest && !latest) return '—'
  if (earliest && latest) {
    const opts = { ...withZone(tz) }
    const sameDay =
      new Date(earliest).toLocaleDateString('en-US', opts) === new Date(latest).toLocaleDateString('en-US', opts)
    return sameDay
      ? `${fmtDateTime(earliest, tz)} – ${fmtTime(latest, tz)}`
      : `${fmtDateTime(earliest, tz)} – ${fmtDateTime(latest, tz)}`
  }
  return fmtDateTime(earliest ?? latest, tz)
}

export function equipmentText(load: Pick<Load, 'equipment_type_text' | 'equipment_type_code' | 'equipment_length_ft'>): string {
  const base = load.equipment_type_text ?? load.equipment_type_code ?? ''
  const len = load.equipment_length_ft != null ? `${Number(load.equipment_length_ft)}'` : ''
  return [len, base].filter(Boolean).join(' ').trim() || '—'
}

export function weightText(load: Pick<Load, 'total_weight' | 'weight_uom'>): string {
  if (load.total_weight == null) return '—'
  return `${Number(load.total_weight).toLocaleString('en-US')} ${load.weight_uom ?? 'lbs'}`
}

export function tempText(load: Pick<Load, 'temp_min' | 'temp_max'>): string | null {
  if (load.temp_min == null && load.temp_max == null) return null
  if (load.temp_min != null && load.temp_max != null) return `${load.temp_min}° to ${load.temp_max}° F`
  return `${load.temp_min ?? load.temp_max}° F`
}

/** The UN/NA numbers on a load, if anyone recorded them as references. */
export function hazmatRefs(references: Array<Pick<LoadReference, 'label' | 'qualifier' | 'value'>>): string[] {
  return references
    .filter((r) => /\b(UN|NA|HAZ)/i.test(`${r.label ?? ''} ${r.qualifier ?? ''}`) || /^(UN|NA)\d{4}$/i.test(r.value ?? ''))
    .map((r) => `${r.label ?? r.qualifier ?? ''} ${r.value ?? ''}`.trim())
    .filter(Boolean)
}
