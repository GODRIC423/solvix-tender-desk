import type { CompanyProfile } from '@/lib/company'
import type {
  Carrier,
  Customer,
  Invoice,
  InvoiceLine,
  Load,
  LoadCharge,
  LoadParty,
  LoadReference,
  LoadStop,
} from '@/types/db'

/** Everything a load document can draw on. Assembled by the Documents panel. */
export interface LoadDocContext {
  company: CompanyProfile
  /** Public URL of the logo, or null for a text-only letterhead. */
  logoUrl: string | null
  load: Load
  stops: LoadStop[]
  parties: LoadParty[]
  references: LoadReference[]
  charges: LoadCharge[]
  customer: Customer | null
  carrier: Carrier | null
  defaultTimezone: string
  /** Only for the invoice document. */
  invoice?: { invoice: Invoice; lines: InvoiceLine[] }
}

export interface CarrierDocContext {
  company: CompanyProfile
  logoUrl: string | null
  carrier: Carrier
}

export interface GeneratedFile {
  blob: Blob
  fileName: string
}
