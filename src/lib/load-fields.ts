/**
 * Describes the load fields shown on the QC review screen.
 *
 * Each descriptor ties three things together:
 *   `key`  — the column on `loads` that the dispatcher actually edits
 *   `path` — where the same value lives inside `raw_extraction`, so we can show
 *            the confidence the parser had and what raw text it read
 *   `group`— which panel it renders in
 *
 * Keeping this as data (rather than hand-written JSX per field) is what makes
 * the in-load search able to find every field, and what makes adding a field a
 * one-line change.
 */

import type { Field, LoadTender } from '@/types/tender'

export interface LoadFieldDescriptor {
  key: string
  label: string
  /** Dotted path into raw_extraction, e.g. 'equipment.type_code'. */
  path?: string
  type?: 'text' | 'number' | 'date' | 'money' | 'boolean'
  /** Hint shown under the input. */
  help?: string
}

export interface LoadFieldGroup {
  title: string
  fields: LoadFieldDescriptor[]
}

export const LOAD_FIELD_GROUPS: LoadFieldGroup[] = [
  {
    title: 'Order',
    fields: [
      { key: 'shipment_id', label: 'Shipment / Order #', path: 'shipment_id' },
      { key: 'tender_date', label: 'Tender date', path: 'tender_date', type: 'date' },
      { key: 'purpose', label: 'Purpose code', path: 'purpose' },
      { key: 'method_of_payment', label: 'Method of payment', path: 'method_of_payment' },
      { key: 'terms', label: 'Terms', path: 'terms' },
    ],
  },
  {
    title: 'Equipment',
    fields: [
      { key: 'equipment_type_code', label: 'Equipment code', path: 'equipment.type_code' },
      { key: 'equipment_type_text', label: 'Equipment', path: 'equipment.type_text' },
      {
        key: 'equipment_length_ft',
        label: 'Length (ft)',
        path: 'equipment.length_ft',
        type: 'number',
      },
      { key: 'equipment_initial', label: 'Trailer initial', path: 'equipment.initial' },
      { key: 'equipment_number', label: 'Trailer #', path: 'equipment.number' },
      { key: 'temp_min', label: 'Temp min', path: 'equipment.temp_min', type: 'number' },
      { key: 'temp_max', label: 'Temp max', path: 'equipment.temp_max', type: 'number' },
    ],
  },
  {
    title: 'Freight',
    fields: [
      { key: 'commodity', label: 'Commodity', path: 'commodity' },
      { key: 'total_weight', label: 'Weight', path: 'total_weight', type: 'number' },
      { key: 'weight_uom', label: 'Weight UOM', path: 'weight_uom' },
      { key: 'total_quantity', label: 'Quantity', path: 'total_quantity', type: 'number' },
      { key: 'distance_miles', label: 'Miles', path: 'distance_miles', type: 'number' },
      { key: 'hazmat', label: 'Hazmat', path: 'hazmat', type: 'boolean' },
    ],
  },
  {
    title: 'Money',
    fields: [
      {
        key: 'customer_rate',
        label: 'Customer rate',
        path: 'total_charge',
        type: 'money',
        help: 'What we bill the customer.',
      },
      {
        key: 'carrier_rate',
        label: 'Carrier rate',
        type: 'money',
        help: 'What we pay the carrier. Set when the load is booked.',
      },
      { key: 'currency', label: 'Currency', path: 'currency' },
    ],
  },
  {
    title: 'Driver & notes',
    fields: [
      { key: 'driver_name', label: 'Driver name', path: 'driver_name' },
      { key: 'driver_phone', label: 'Driver phone', path: 'driver_phone' },
      { key: 'scac', label: 'SCAC', path: 'scac' },
      { key: 'mc_number', label: 'MC #', path: 'mc_number' },
      { key: 'notes', label: 'Notes', path: 'notes' },
    ],
  },
]

/** Every descriptor, flattened — used by search and by the "missing fields" roll-up. */
export const ALL_LOAD_FIELDS: LoadFieldDescriptor[] = LOAD_FIELD_GROUPS.flatMap((g) => g.fields)

function isField(value: unknown): value is Field {
  return (
    typeof value === 'object' &&
    value !== null &&
    'c' in (value as Record<string, unknown>) &&
    'v' in (value as Record<string, unknown>)
  )
}

/** Read `{v,c,s,raw}` out of raw_extraction by dotted path. */
export function fieldAt(
  extraction: LoadTender | null | undefined,
  path: string | undefined,
): Field | null {
  if (!extraction || !path) return null
  let cursor: unknown = extraction
  for (const part of path.split('.')) {
    if (cursor === null || typeof cursor !== 'object') return null
    cursor = (cursor as Record<string, unknown>)[part]
  }
  return isField(cursor) ? cursor : null
}

export function confidenceAt(
  extraction: LoadTender | null | undefined,
  path: string | undefined,
): number | null {
  const f = fieldAt(extraction, path)
  return f ? f.c : null
}

/**
 * Walks a whole tender and returns the mean confidence over populated fields —
 * the same definition the legacy engine used for its overall score, so a score
 * computed here matches one computed at ingest.
 */
export function meanConfidence(extraction: LoadTender | null | undefined): number | null {
  if (!extraction) return null
  const scores: number[] = []

  const visit = (node: unknown) => {
    if (node === null || typeof node !== 'object') return
    if (isField(node)) {
      if (node.v !== null && node.v !== undefined && node.v !== '') scores.push(node.c)
      return
    }
    if (Array.isArray(node)) {
      node.forEach(visit)
      return
    }
    Object.values(node as Record<string, unknown>).forEach(visit)
  }

  visit(extraction)
  if (!scores.length) return null
  return Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 1000) / 1000
}
