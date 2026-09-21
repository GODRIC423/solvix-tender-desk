import { companyIdLine, companyLines, type CompanyProfile } from '@/lib/company'
import type { Carrier, Customer, Load, LoadParty, LoadReference, LoadStop } from '@/types/db'
import type { PdfDoc } from './kit'
import { fmtDateTime, fmtWindow } from './data'

/** The lines that describe a party, skipping whatever is blank. */
function addressLines(p: {
  address1?: string | null
  address2?: string | null
  city?: string | null
  state?: string | null
  postal?: string | null
}): string[] {
  const cityLine = [p.city, [p.state, p.postal].filter(Boolean).join(' ')].filter(Boolean).join(', ')
  return [p.address1 ?? '', p.address2 ?? '', cityLine].filter((s) => s.trim() !== '')
}

export function stopLines(stop: LoadStop | undefined, tz: string): string[] {
  if (!stop) return ['—']
  return [
    stop.name ?? '',
    ...addressLines(stop),
    [stop.contact_name, stop.phone].filter(Boolean).join(' · '),
    fmtWindow(stop.earliest, stop.latest, stop.timezone ?? tz),
    stop.appointment_number ? `Appt # ${stop.appointment_number}` : '',
  ]
}

export function partyLines(p: LoadParty): string[] {
  return [p.name ?? '', ...addressLines(p), [p.contact_name, p.phone, p.email].filter(Boolean).join(' · ')]
}

export function customerLines(c: Customer | null): string[] {
  if (!c) return ['—']
  return [
    c.name,
    ...addressLines(c),
    [c.main_contact_name, c.main_contact_phone, c.main_contact_email].filter(Boolean).join(' · '),
  ]
}

export function carrierLines(c: Carrier | null, load: Load): string[] {
  if (!c) return ['No carrier assigned yet']
  const ids = [c.mc_number && `MC ${c.mc_number}`, c.dot_number && `DOT ${c.dot_number}`, c.scac]
    .filter(Boolean)
    .join(' · ')
  const truck = [load.equipment_initial, load.equipment_number].filter(Boolean).join('')
  return [
    c.name,
    ids,
    ...addressLines(c),
    [c.dispatch_contact_name, c.dispatch_contact_phone, c.dispatch_contact_email].filter(Boolean).join(' · '),
    load.driver_name ? `Driver: ${[load.driver_name, load.driver_phone].filter(Boolean).join(' · ')}` : '',
    truck ? `Truck / trailer: ${truck}` : '',
  ]
}

export function brokerLines(company: CompanyProfile): string[] {
  return [
    company.name,
    companyIdLine(company),
    ...companyLines(company),
    [company.phone, company.email].filter(Boolean).join(' · '),
  ]
}

export function carrierAddress(c: Carrier): string {
  return addressLines(c).join(', ')
}

export function refsText(references: LoadReference[]): string | null {
  const parts = references
    .filter((r) => r.value)
    .map((r) => `${r.label ?? r.qualifier ?? 'Ref'}: ${r.value}`)
  return parts.length ? parts.join(' · ') : null
}

export function refsMatching(references: LoadReference[], pattern: RegExp): string[] {
  return references
    .filter((r) => r.value && pattern.test(`${r.label ?? ''} ${r.qualifier ?? ''}`))
    .map((r) => r.value as string)
}

/** The stops table shared by the rate confirmation, BOL and load sheet. */
export function stopsTable(
  pdf: PdfDoc,
  stops: LoadStop[],
  tz: string,
  opts: { instructions?: boolean; contacts?: boolean } = {},
): void {
  const head = ['#', 'Type', 'Facility', 'Window']
  if (opts.contacts) head.push('Contact')
  if (opts.instructions) head.push('Instructions')
  const body = stops.map((s, i) => {
    const facility = [s.name, ...addressLines(s)].filter(Boolean).join('\n')
    const window = [
      fmtWindow(s.earliest, s.latest, s.timezone ?? tz),
      s.appointment ? `Appt ${fmtDateTime(s.appointment, s.timezone ?? tz)}` : '',
      s.appointment_number ? `Appt # ${s.appointment_number}` : '',
    ]
      .filter(Boolean)
      .join('\n')
    const row: string[] = [String(s.sequence ?? i + 1), (s.stop_type ?? 'stop').toUpperCase(), facility, window]
    if (opts.contacts) row.push([s.contact_name, s.phone].filter(Boolean).join('\n'))
    if (opts.instructions) row.push(s.instructions ?? '')
    return row
  })
  pdf.table(head, body, {
    columnStyles: { 0: { cellWidth: 22 }, 1: { cellWidth: 58 }, 3: { cellWidth: 118 } },
  })
}

export function footerFor(company: CompanyProfile): string {
  return [company.name, company.phone, company.email].filter(Boolean).join(' · ')
}
