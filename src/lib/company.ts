/**
 * The company profile — what goes on the letterhead of everything we send
 * out, plus the text of the broker-carrier agreement. Lives in
 * org_settings.company as JSON; this file gives it a shape and defaults.
 */

export interface CompanyProfile {
  name: string
  dba: string | null
  address1: string | null
  address2: string | null
  city: string | null
  state: string | null
  postal: string | null
  phone: string | null
  email: string | null
  website: string | null
  mc_number: string | null
  dot_number: string | null
  scac: string | null
  /** Where customers send payment, if different from the address above. */
  remit_to: string | null
  payment_terms_days: number
  invoice_footer: string | null
  /** Object key in the public `branding` bucket, e.g. "logo.png". */
  logo_path: string | null
  /** The broker-carrier agreement template. {{placeholders}} are filled at print time. */
  agreement_text: string | null
}

export const EMPTY_COMPANY: CompanyProfile = {
  name: '',
  dba: null,
  address1: null,
  address2: null,
  city: null,
  state: null,
  postal: null,
  phone: null,
  email: null,
  website: null,
  mc_number: null,
  dot_number: null,
  scac: null,
  remit_to: null,
  payment_terms_days: 30,
  invoice_footer: null,
  logo_path: null,
  agreement_text: null,
}

const TEXT_KEYS = [
  'dba', 'address1', 'address2', 'city', 'state', 'postal', 'phone', 'email', 'website',
  'mc_number', 'dot_number', 'scac', 'remit_to', 'invoice_footer', 'logo_path', 'agreement_text',
] as const

/** Whatever is in the JSON column, given the full shape with safe values. */
export function normalizeCompany(raw: unknown): CompanyProfile {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const out: CompanyProfile = { ...EMPTY_COMPANY }
  out.name = typeof src.name === 'string' ? src.name : ''
  for (const k of TEXT_KEYS) {
    const v = src[k]
    out[k] = typeof v === 'string' && v.trim() !== '' ? v : null
  }
  const terms = Number(src.payment_terms_days)
  out.payment_terms_days = Number.isFinite(terms) && terms >= 0 ? Math.round(terms) : 30
  return out
}

/** The address as it prints: only the lines that exist. */
export function companyLines(c: CompanyProfile): string[] {
  const cityLine = [c.city, [c.state, c.postal].filter(Boolean).join(' ')]
    .filter((s) => s && String(s).trim() !== '')
    .join(', ')
  return [c.address1, c.address2, cityLine].filter((s): s is string => Boolean(s && s.trim()))
}

export function companyIdLine(c: CompanyProfile): string {
  return [c.mc_number && `MC ${c.mc_number}`, c.dot_number && `DOT ${c.dot_number}`, c.scac]
    .filter(Boolean)
    .join(' · ')
}

/**
 * Fill {{placeholders}} in a template. Unknown keys render blank rather than
 * leaking the braces onto a signed document.
 */
export function renderTemplate(text: string, vars: Record<string, string | null | undefined>): string {
  return text.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => vars[key] ?? '')
}

/**
 * A standard broker-carrier agreement. It is a starting point: the owner
 * edits it in Settings and should have counsel review it before use.
 * Lines beginning with "# " print as headings; blank lines split paragraphs.
 */
export const DEFAULT_AGREEMENT_TEXT = `# Broker-Carrier Agreement

This Broker-Carrier Agreement (the "Agreement") is made on {{date}} between {{broker_name}}, a licensed property broker (MC {{broker_mc}}) with offices at {{broker_address}} ("Broker"), and {{carrier_name}}, a motor carrier (MC {{carrier_mc}}, USDOT {{carrier_dot}}) with offices at {{carrier_address}} ("Carrier").

# 1. Services

Broker arranges for the transportation of freight on behalf of its customers. Carrier agrees to transport such freight as Broker may tender from time to time, in accordance with the terms of this Agreement and the rate confirmation issued for each shipment. Nothing in this Agreement obligates Broker to tender, or Carrier to accept, any minimum number of shipments.

# 2. Carrier's authority and compliance

Carrier represents that it holds, and will maintain throughout this Agreement, valid operating authority from the FMCSA, that it is not currently rated "Unsatisfactory" or "Conditional" by any regulatory body, and that it will comply with all applicable federal, state and local laws, including hours-of-service, drug and alcohol testing, and equipment safety regulations. Carrier will notify Broker in writing within 24 hours of any change in its authority, safety rating or insurance.

# 3. Insurance

Carrier will maintain, at its own expense, at least the following coverage with insurers acceptable to Broker: automobile liability of not less than $1,000,000 per occurrence; cargo liability of not less than $100,000 per occurrence; and workers' compensation as required by law. Carrier will furnish certificates of insurance naming Broker as certificate holder before its first shipment and on each renewal, and will provide at least 30 days' notice of cancellation or material change.

# 4. Rates and payment

The rate for each shipment is stated on the rate confirmation for that shipment, which is incorporated into this Agreement. Broker will pay Carrier within {{payment_terms_days}} days of receiving Carrier's invoice together with a signed proof of delivery and any receipts for approved accessorial charges. Carrier will look solely to Broker, and not to Broker's customers, for payment, and will not bill or collect from any shipper, consignee or customer of Broker.

# 5. No back-solicitation

During the term of this Agreement and for one year after it ends, Carrier will not solicit or accept freight directly from any customer of Broker that was first made known to Carrier through Broker, other than through Broker. Should Carrier breach this section, Broker is entitled to a commission of 15% of the gross revenue of each such shipment, in addition to any other remedy.

# 6. Independent contractor

Carrier is an independent contractor. Carrier has exclusive control over its drivers, equipment and operations, and is solely responsible for wages, taxes, benefits and the acts and omissions of its employees and agents. Nothing in this Agreement creates a partnership, joint venture, agency or employment relationship.

# 7. Loss, damage and delay

Carrier is liable for loss of, damage to, or delay of freight in its care, custody or control to the full extent provided by 49 U.S.C. § 14706 (the Carmack Amendment), without limitation unless agreed in writing for a specific shipment. Carrier will acknowledge claims within 30 days and pay, decline or make a firm compromise offer within 120 days of receipt.

# 8. Indemnity

Each party will defend, indemnify and hold harmless the other and its customers from any claim, loss, liability or expense, including reasonable attorneys' fees, arising from the indemnifying party's negligence, willful misconduct or breach of this Agreement, except to the extent caused by the other party.

# 9. Term and termination

This Agreement begins on the date above and continues until either party ends it on 30 days' written notice. Either party may end it immediately on written notice if the other party materially breaches it. Obligations that by their nature survive termination, including sections 4, 5, 7 and 8, survive.

# 10. General

This Agreement, together with each rate confirmation, is the entire agreement between the parties on its subject and supersedes any prior agreement. It may be amended only in a writing signed by both parties. It is governed by the laws of the state in which Broker's principal office is located. A signed copy transmitted electronically is as effective as an original.`
