import type { CompanyProfile } from '@/lib/company'
import { PdfDoc, type LogoImage } from './kit'
import type { LoadDocContext } from './context'
import {
  carrierPayLinesForLoad,
  equipmentText,
  fmtDate,
  money,
  sumLines,
  tempText,
  toIsoDate,
  weightText,
} from './data'
import { brokerLines, carrierLines, footerFor, refsText, stopsTable } from './shared'

function defaultTerms(company: CompanyProfile): string {
  const who = company.name || 'Broker'
  return (
    `Carrier agrees to transport the shipment described above for the total shown, which is ` +
    `all-inclusive of fuel. This confirmation is subject to the Broker-Carrier Agreement between ` +
    `the parties. Carrier must call ${who} for dispatch before pickup and provide check calls on ` +
    `request. Detention, layover and other accessorials are payable only when approved in writing ` +
    `by ${who} before they are incurred. Payment is made within ${company.payment_terms_days} days ` +
    `of receipt of Carrier's invoice together with a signed proof of delivery. Double brokering or ` +
    `re-brokering of this shipment is prohibited and voids payment.`
  )
}

/** The document a carrier signs to take the load: who, where, when, and for how much. */
export function buildRateConfirmation(ctx: LoadDocContext, logo: LogoImage | null): PdfDoc {
  const { company, load, stops, charges, carrier, references } = ctx
  const pdf = new PdfDoc()

  pdf.letterhead({
    company,
    logo,
    title: 'Rate Confirmation',
    subtitle: `Load ${load.load_number}`,
    meta: [
      ['Date', fmtDate(toIsoDate(new Date()))],
      ['Shipment ID', load.shipment_id ?? '—'],
      ['Equipment', equipmentText(load)],
    ],
  })

  pdf.columns([
    { title: 'Carrier', lines: carrierLines(carrier, load) },
    { title: 'Broker', lines: brokerLines(company) },
  ])

  pdf.h2('Stops')
  stopsTable(pdf, stops, ctx.defaultTimezone, { instructions: true })

  pdf.h2('Load')
  pdf.kv([
    ['Commodity', load.commodity],
    ['Weight', weightText(load)],
    ['Pieces', load.total_quantity != null ? String(load.total_quantity) : null],
    ['Temperature', tempText(load)],
    ['Hazmat', load.hazmat ? 'YES — see shipping papers' : null],
    ['Miles', load.distance_miles != null ? String(Math.round(Number(load.distance_miles))) : null],
    ['References', refsText(references)],
  ])

  pdf.h2('Carrier pay')
  const lines = carrierPayLinesForLoad(load, charges)
  if (lines.length === 0) {
    pdf.text('No carrier rate has been entered on this load yet.', { muted: true })
  } else {
    pdf.table(
      ['Description', 'Amount'],
      lines.map((l) => [l.description, money(l.amount)]),
      { foot: ['Total carrier pay', money(sumLines(lines))], columnStyles: { 1: { halign: 'right', cellWidth: 110 } } },
    )
  }

  pdf.h2('Terms')
  pdf.text(load.terms?.trim() || defaultTerms(company))

  pdf.signatures(['Carrier signature', 'Date', `${company.name || 'Broker'} — authorized`])
  pdf.setFooter(footerFor(company))
  return pdf
}
