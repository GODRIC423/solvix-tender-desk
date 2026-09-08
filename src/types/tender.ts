/**
 * Canonical LoadTender shape.
 *
 * This is a direct typing of what the original single-file engine produced
 * (legacy/index.html, `Pipeline.emptyTender()` ~L704). Keeping the shape
 * byte-compatible matters: the connector posts this JSON straight to the
 * ingest Edge Function, and old exported workspaces should still import.
 */

/** Confidence-scored leaf value. `F(v, c, s, raw)` in the legacy engine. */
export interface Field<T = string | number | boolean | null> {
  /** Parsed value, or null when nothing was found. */
  v: T | null
  /** Confidence, 0..1. */
  c: number
  /** Where the value came from. */
  s: FieldSource | ''
  /** The raw text this was read from, for audit + "show me where you got that". */
  raw: string
}

export type FieldSource =
  | 'parsed'
  | 'derived'
  | 'letterhead'
  | 'config'
  | 'manual'
  | 'summed'

export interface Party {
  name: Field
  address1: Field
  address2: Field
  city: Field
  state: Field
  postal: Field
  country: Field
  code: Field
  contact_name: Field
  phone: Field
  email: Field
  fax: Field
}

export interface Equipment {
  type_code: Field
  type_text: Field
  length_ft: Field
  initial: Field
  number: Field
  temp_min: Field
  temp_max: Field
}

export interface TenderReference {
  label?: string
  qualifier: Field
  value: Field
}

export interface TenderCharge {
  description: Field
  code: Field
  quantity: Field
  rate: Field
  amount: Field
}

export interface TenderItem {
  description?: Field
  quantity?: Field
  weight?: Field
  po_number?: Field
  [key: string]: Field | undefined
}

export type StopType = 'pickup' | 'delivery' | 'unknown' | 'other'

export interface Stop {
  sequence: Field
  stop_type: Field
  reason_code: Field
  party: Party
  earliest: Field
  latest: Field
  appointment: Field
  appointment_number: Field
  weight: Field
  weight_uom: Field
  quantity: Field
  instructions: Field
  references: TenderReference[]
  items: TenderItem[]
}

export interface LoadTender {
  shipment_id: Field
  purpose: Field
  scac: Field
  method_of_payment: Field
  tender_date: Field
  shipper: Party
  bill_to: Party
  carrier: Party
  mc_number: Field
  equipment: Equipment
  total_weight: Field
  weight_uom: Field
  commodity: Field
  distance_miles: Field
  total_quantity: Field
  hazmat: Field
  total_charge: Field
  currency: Field
  charges: TenderCharge[]
  stops: Stop[]
  references: TenderReference[]
  notes: Field
  terms: Field
  driver_name: Field
  driver_phone: Field
  source_file: string
  source_kind: string
  extracted_at: string
  warnings: string[]
}

/*
 * Note: the confidence-report and source-page shapes are NOT declared here.
 *
 * Earlier drafts of this file guessed at them, and the guesses were wrong —
 * the engine emits `{path, value, confidence, source}` for report entries and
 * `{number, words, text, width, height, source, meanConf, image}` for pages.
 * Rather than keep a type that lies about the runtime, the accurate ones live
 * next to the code that produces them:
 *
 *   EngineConfidenceReport, ConfidenceField  -> lib/tender-engine/pipeline.ts
 *   IngestPage, IngestResult                 -> lib/tender-engine/ingest.ts
 */
