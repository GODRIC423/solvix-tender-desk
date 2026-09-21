import { companyLines } from '@/lib/company'
import { PdfDoc, type LogoImage } from './kit'
import type { LoadDocContext } from './context'
import { fmtDate, laneText, money, weightText } from './data'
import { customerLines, footerFor, partyLines, refsMatching } from './shared'

/** What the customer pays, with where to send it. Needs ctx.invoice. */
export function buildInvoice(ctx: LoadDocContext, logo: LogoImage | null): PdfDoc {
  const inv = ctx.invoice
  if (!inv) throw new Error('buildInvoice needs ctx.invoice')
  const { company, load, parties, references, customer } = ctx
  const { invoice, lines } = inv
  const pdf = new PdfDoc()

  pdf.letterhead({
    company,
    logo,
    title: 'Invoice',
    subtitle: invoice.invoice_number,
    meta: [
      ['Invoice date', fmtDate(invoice.issued_at)],
      ['Due', fmtDate(invoice.due_at)],
      ['Terms', `Net ${company.payment_terms_days}`],
      ['Load', load.load_number],
    ],
  })

  const billTo = parties.find((p) => p.role === 'bill_to')
  const remitTo = company.remit_to?.trim()
    ? company.remit_to.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
    : [company.name, ...companyLines(company)]
  pdf.columns([
    { title: 'Bill to', lines: billTo ? partyLines(billTo) : customerLines(customer) },
    { title: 'Remit to', lines: remitTo },
  ])

  pdf.h2('Shipment')
  const po = refsMatching(references, /\bPO\b|purchase order/i).join(', ')
  const bol = refsMatching(references, /\bBOL\b|bill of lading/i).join(', ')
  pdf.kv([
    ['Lane', laneText(load) || null],
    ['Shipment ID', load.shipment_id],
    ['PO #', po || null],
    ['BOL #', bol || null],
    ['Delivered', load.delivered_at ? fmtDate(load.delivered_at) : null],
    ['Commodity', load.commodity],
    ['Weight', load.total_weight != null ? weightText(load) : null],
  ])

  pdf.h2('Charges')
  pdf.table(
    ['Description', 'Qty', 'Rate', 'Amount'],
    lines.map((l) => [l.description, String(l.quantity), l.rate != null ? money(l.rate, invoice.currency) : '', money(l.amount, invoice.currency)]),
    {
      foot: ['', '', 'Total due', money(invoice.total, invoice.currency)],
      columnStyles: {
        1: { cellWidth: 44, halign: 'right' },
        2: { cellWidth: 90, halign: 'right' },
        3: { cellWidth: 100, halign: 'right' },
      },
    },
  )

  if (invoice.notes) {
    pdf.h2('Notes')
    pdf.text(invoice.notes)
  }

  pdf.text(
    `Please reference ${invoice.invoice_number} with your payment. Thank you for your business.`,
    { muted: true },
  )

  pdf.setFooter(company.invoice_footer?.trim() || footerFor(company))
  return pdf
}
