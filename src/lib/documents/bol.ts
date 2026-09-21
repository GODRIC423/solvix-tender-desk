import { PdfDoc, type LogoImage } from './kit'
import type { LoadDocContext } from './context'
import { fmtDate, hazmatRefs, tempText, toIsoDate, weightText } from './data'
import { carrierLines, customerLines, footerFor, partyLines, refsMatching, stopLines, stopsTable } from './shared'

const RECEIPT_CLAUSE =
  'RECEIVED, subject to individually determined rates or contracts that have been agreed upon in ' +
  'writing between the carrier and shipper, if applicable, otherwise to the rates, classifications ' +
  'and rules that have been established by the carrier and are available to the shipper on request, ' +
  'the property described above, in apparent good order except as noted (contents and condition of ' +
  'contents of packages unknown), marked, consigned and destined as shown, which the carrier agrees ' +
  'to carry to the destination and to deliver to the consignee. The shipper certifies that the ' +
  'materials are properly classified, described, packaged, marked and labeled, and are in proper ' +
  'condition for transportation according to the applicable regulations of the DOT.'

/** The shipper's receipt and the driver's paperwork, from the load's stops and parties. */
export function buildBillOfLading(ctx: LoadDocContext, logo: LogoImage | null): PdfDoc {
  const { company, load, stops, parties, references, carrier, customer } = ctx
  const tz = ctx.defaultTimezone
  const pdf = new PdfDoc()

  const pickups = stops.filter((s) => s.stop_type === 'pickup')
  const deliveries = stops.filter((s) => s.stop_type === 'delivery')
  const shipFrom = pickups[0] ?? stops[0]
  const shipTo = deliveries[deliveries.length - 1] ?? stops[stops.length - 1]

  const bolNumber = refsMatching(references, /\bBOL\b|bill of lading/i)[0] ?? load.load_number
  const poNumbers = refsMatching(references, /\bPO\b|purchase order/i).join(', ')

  pdf.letterhead({
    company,
    logo,
    title: 'Bill of Lading',
    subtitle: 'Straight bill of lading — short form',
    meta: [
      ['BOL #', bolNumber],
      ['Date', fmtDate(toIsoDate(new Date()))],
      ['Load', load.load_number],
      ...(poNumbers ? ([['PO #', poNumbers]] as Array<[string, string]>) : []),
    ],
  })

  pdf.columns([
    { title: 'Ship from', lines: stopLines(shipFrom, tz) },
    { title: 'Ship to', lines: stopLines(shipTo, tz) },
  ])
  const billTo = parties.find((p) => p.role === 'bill_to')
  pdf.columns([
    { title: 'Bill to', lines: billTo ? partyLines(billTo) : customerLines(customer) },
    { title: 'Carrier', lines: carrierLines(carrier, load) },
  ])

  if (stops.length > 2) {
    pdf.h2('All stops')
    stopsTable(pdf, stops, tz)
  }

  pdf.h2('Commodity')
  pdf.table(
    ['Qty', 'Description', 'Weight', 'HM'],
    [[
      load.total_quantity != null ? String(load.total_quantity) : '',
      load.commodity ?? 'Freight, all kinds',
      weightText(load),
      load.hazmat ? 'X' : '',
    ]],
    { columnStyles: { 0: { cellWidth: 50 }, 2: { cellWidth: 100, halign: 'right' }, 3: { cellWidth: 34, halign: 'center' } } },
  )

  const temp = tempText(load)
  const special = [
    temp ? `Temperature: ${temp}` : null,
    load.hazmat ? `HAZMAT — ${hazmatRefs(references).join(', ') || 'see shipping papers'}` : null,
    ...stops.map((s) =>
      s.instructions ? `${(s.stop_type ?? 'Stop').replace(/^\w/, (c) => c.toUpperCase())} ${s.sequence ?? ''}: ${s.instructions}` : null,
    ),
    load.notes,
  ].filter((s): s is string => Boolean(s && s.trim()))
  if (special.length > 0) {
    pdf.h2('Special instructions')
    special.forEach((s) => pdf.text(`• ${s}`, { gap: 1 }))
    pdf.y += 4
  }

  pdf.h2('Terms')
  pdf.text(RECEIPT_CLAUSE, { size: 7.5, muted: true })

  pdf.signatures(['Shipper signature / date', 'Carrier (driver) signature / date', 'Consignee signature / date'])
  pdf.setFooter(footerFor(company))
  return pdf
}
