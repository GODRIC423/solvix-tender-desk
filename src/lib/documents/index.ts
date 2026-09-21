/**
 * Entry point for generating documents. Import this module lazily — it pulls
 * in jsPDF, which most people on the desk never need:
 *
 *   const { generateLoadDocument } = await import('@/lib/documents')
 */
import { loadLogo } from './kit'
import { documentFileName } from './data'
import { buildRateConfirmation } from './rate-confirmation'
import { buildBillOfLading } from './bol'
import { buildLoadSheet } from './load-sheet'
import { buildInvoice } from './invoice'
import { buildCarrierAgreement } from './carrier-agreement'
import type { CarrierDocContext, GeneratedFile, LoadDocContext } from './context'

export type { CarrierDocContext, GeneratedFile, LoadDocContext } from './context'

export type GeneratedLoadKind = 'rate_confirmation' | 'bol' | 'load_sheet' | 'invoice'

export async function generateLoadDocument(
  kind: GeneratedLoadKind,
  ctx: LoadDocContext,
  version = 1,
): Promise<GeneratedFile> {
  const logo = await loadLogo(ctx.logoUrl)
  const pdf =
    kind === 'rate_confirmation'
      ? buildRateConfirmation(ctx, logo)
      : kind === 'bol'
        ? buildBillOfLading(ctx, logo)
        : kind === 'load_sheet'
          ? buildLoadSheet(ctx, logo)
          : buildInvoice(ctx, logo)
  const fileName =
    kind === 'invoice' && ctx.invoice
      ? `${ctx.invoice.invoice.invoice_number}.pdf`
      : documentFileName(kind, ctx.load.load_number, version)
  return { blob: pdf.finish(), fileName }
}

export async function generateCarrierAgreement(ctx: CarrierDocContext): Promise<GeneratedFile> {
  const logo = await loadLogo(ctx.logoUrl)
  const pdf = buildCarrierAgreement(ctx, logo)
  const slug = ctx.carrier.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'carrier'
  return { blob: pdf.finish(), fileName: `${slug}-broker-carrier-agreement.pdf` }
}
