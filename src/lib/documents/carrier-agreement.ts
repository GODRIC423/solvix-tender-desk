import { companyLines, DEFAULT_AGREEMENT_TEXT, renderTemplate } from '@/lib/company'
import { PdfDoc, type LogoImage } from './kit'
import type { CarrierDocContext } from './context'
import { fmtDate, toIsoDate } from './data'
import { carrierAddress, footerFor } from './shared'

/**
 * The agreement text from Settings (or the standard one), filled in for this
 * carrier and laid out with signature blocks for both parties.
 */
export function buildCarrierAgreement(ctx: CarrierDocContext, logo: LogoImage | null): PdfDoc {
  const { company, carrier } = ctx
  const pdf = new PdfDoc()
  const blank = '____________'

  const text = renderTemplate(company.agreement_text?.trim() || DEFAULT_AGREEMENT_TEXT, {
    date: fmtDate(toIsoDate(new Date())),
    broker_name: company.name || blank,
    broker_mc: company.mc_number ?? blank,
    broker_address: companyLines(company).join(', ') || blank,
    carrier_name: carrier.name,
    carrier_mc: carrier.mc_number ?? blank,
    carrier_dot: carrier.dot_number ?? blank,
    carrier_address: carrierAddress(carrier) || blank,
    payment_terms_days: String(company.payment_terms_days),
  })

  const title = 'Broker-Carrier Agreement'
  pdf.letterhead({
    company,
    logo,
    title,
    subtitle: carrier.name,
    meta: [
      ['Date', fmtDate(toIsoDate(new Date()))],
      ['Carrier MC', carrier.mc_number ?? '—'],
      ['Carrier DOT', carrier.dot_number ?? '—'],
    ],
  })

  for (const block of text.split(/\n\s*\n/)) {
    const para = block.trim()
    if (!para) continue
    if (para.startsWith('# ')) {
      const heading = para.slice(2).trim()
      if (heading.toLowerCase() !== title.toLowerCase()) pdf.h2(heading)
      continue
    }
    pdf.text(para, { gap: 6 })
  }

  pdf.h2('Signatures')
  pdf.columns([
    {
      title: 'Broker',
      lines: [company.name || blank, 'By: ______________________________', 'Name / title: ____________________', 'Date: ____________'],
    },
    {
      title: 'Carrier',
      lines: [carrier.name, 'By: ______________________________', 'Name / title: ____________________', 'Date: ____________'],
    },
  ])

  pdf.setFooter(footerFor(company))
  return pdf
}
