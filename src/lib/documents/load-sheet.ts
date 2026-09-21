import { PdfDoc, type LogoImage } from './kit'
import type { LoadDocContext } from './context'
import { equipmentText, fmtDate, hazmatRefs, tempText, toIsoDate, weightText } from './data'
import { carrierLines, customerLines, footerFor, refsText, stopsTable } from './shared'

/**
 * The internal / driver sheet: every stop with its contacts and appointment
 * numbers, plus the handling the freight needs — cold chain, hazmat — and
 * nothing about money.
 */
export function buildLoadSheet(ctx: LoadDocContext, logo: LogoImage | null): PdfDoc {
  const { company, load, stops, references, carrier, customer } = ctx
  const pdf = new PdfDoc()

  pdf.letterhead({
    company,
    logo,
    title: 'Load Sheet',
    subtitle: `Load ${load.load_number}`,
    meta: [
      ['Date', fmtDate(toIsoDate(new Date()))],
      ['Shipment ID', load.shipment_id ?? '—'],
      ['Equipment', equipmentText(load)],
    ],
  })

  pdf.columns([
    { title: 'Customer', lines: customerLines(customer) },
    { title: 'Carrier & driver', lines: carrierLines(carrier, load) },
  ])

  pdf.h2('Stops')
  stopsTable(pdf, stops, ctx.defaultTimezone, { contacts: true, instructions: true })

  pdf.h2('Freight')
  pdf.kv([
    ['Commodity', load.commodity],
    ['Weight', weightText(load)],
    ['Pieces', load.total_quantity != null ? String(load.total_quantity) : null],
    ['Equipment', equipmentText(load)],
    ['Miles', load.distance_miles != null ? String(Math.round(Number(load.distance_miles))) : null],
    ['References', refsText(references)],
  ])

  const temp = tempText(load)
  const reefer = /reefer|refrig|temp/i.test(`${load.equipment_type_text ?? ''} ${load.equipment_type_code ?? ''}`)
  if (temp || reefer) {
    pdf.h2('Cold storage / temperature control')
    pdf.text(
      temp
        ? `Maintain ${temp}, continuous run, for the whole trip. Pre-cool the trailer before loading.`
        : 'Temperature-controlled equipment. Confirm the set point with the shipper before loading and run continuous.',
    )
    pdf.checklist([
      'Trailer pre-cooled to set point before arrival at shipper',
      'Temperature at loading recorded: __________     Seal #: __________',
      'Temperature checked in transit at least every 4 hours',
      'Temperature at delivery recorded: __________     Seal intact on arrival',
    ])
  }

  if (load.hazmat) {
    pdf.h2('Hazardous materials')
    const un = hazmatRefs(references)
    pdf.text(un.length ? `UN / NA numbers: ${un.join(', ')}` : 'UN / NA numbers: as shown on the shipping papers.')
    pdf.checklist([
      'Driver holds a current hazmat endorsement',
      'Placards applied for the class shown on the shipping papers',
      'Shipping papers and emergency response information within reach of the driver',
      'Emergency contact number: ______________________',
    ])
  }

  if (load.notes) {
    pdf.h2('Notes')
    pdf.text(load.notes)
  }

  pdf.setFooter(footerFor(company))
  return pdf
}
