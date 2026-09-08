/**
 * Row shapes for the Supabase tables. Hand-written rather than generated so the
 * app compiles before a database exists; regenerate with
 * `supabase gen types typescript` once the project is linked and reconcile.
 */

import type { LoadTender } from './tender'

export type Role = 'admin' | 'dispatcher' | 'viewer'

export interface Profile {
  id: string
  full_name: string | null
  email: string | null
  role: Role
  active: boolean
  created_at: string
  updated_at: string
}

export interface PipelineStage {
  id: string
  key: string
  label: string
  sort_order: number
  is_terminal: boolean
  is_booked: boolean
  active: boolean
}

export interface FlagType {
  id: string
  key: string
  label: string
  sort_order: number
  active: boolean
}

export interface InteractionType {
  id: string
  key: string
  label: string
  sort_order: number
  severity: 'info' | 'warn' | 'critical'
  active: boolean
}

export interface Metro {
  id: string
  name: string
  state: string | null
  cbsa_code: string | null
  center_lat: number | null
  center_lon: number | null
  aliases: string[] | null
}

export interface Customer {
  id: string
  name: string
  mc_number: string | null
  address1: string | null
  address2: string | null
  city: string | null
  state: string | null
  postal: string | null
  country: string | null
  main_contact_name: string | null
  main_contact_phone: string | null
  main_contact_email: string | null
  notes: string | null
  active: boolean
  created_at: string
  updated_at: string
  created_by: string | null
}

export interface Carrier {
  id: string
  name: string
  dot_number: string | null
  mc_number: string | null
  scac: string | null
  address1: string | null
  address2: string | null
  city: string | null
  state: string | null
  postal: string | null
  country: string | null
  dispatch_contact_name: string | null
  dispatch_contact_phone: string | null
  dispatch_contact_email: string | null
  equipment_types: string[] | null
  status: 'active' | 'inactive' | 'do_not_use'
  notes: string | null
  created_at: string
  updated_at: string
  created_by: string | null
}

export interface Load {
  id: string
  load_number: string
  pipeline_stage_id: string
  source: 'manual' | 'tender_upload' | 'edi_204'
  source_file_url: string | null
  source_file_name: string | null
  qc_score: number | null
  raw_extraction: LoadTender | null
  warnings: string[] | null

  customer_id: string | null
  carrier_id: string | null

  shipment_id: string | null
  purpose: string | null
  scac: string | null
  method_of_payment: string | null
  tender_date: string | null
  mc_number: string | null
  equipment_type_code: string | null
  equipment_type_text: string | null
  equipment_length_ft: number | null
  equipment_initial: string | null
  equipment_number: string | null
  temp_min: number | null
  temp_max: number | null
  total_weight: number | null
  weight_uom: string | null
  commodity: string | null
  distance_miles: number | null
  total_quantity: number | null
  hazmat: boolean | null
  notes: string | null
  terms: string | null
  driver_name: string | null
  driver_phone: string | null

  customer_rate: number | null
  carrier_rate: number | null
  currency: string | null
  margin: number | null

  first_pickup_at: string | null
  last_delivery_at: string | null
  origin_city: string | null
  origin_state: string | null
  origin_metro_id: string | null
  dest_city: string | null
  dest_state: string | null
  dest_metro_id: string | null

  booked_at: string | null
  appt_set_at: string | null
  appt_ready_at: string | null
  in_transit_at: string | null
  delivered_at: string | null
  pod_received_at: string | null
  invoiced_at: string | null
  paid_at: string | null
  cancelled_at: string | null
  last_touched_at: string | null

  created_at: string
  updated_at: string
  created_by: string | null
}

/** Row shape of the `v_load_board` view — everything the board needs, pre-joined. */
export interface LoadBoardRow extends Load {
  stage_key: string
  stage_label: string
  stage_is_booked: boolean
  stage_is_terminal: boolean
  stage_sort_order: number
  customer_name: string | null
  carrier_name: string | null
  carrier_dot_number: string | null
  open_flag_count: number
  has_tracking_event: boolean
  latest_tracking_at: string | null
}

export interface LoadStop {
  id: string
  load_id: string
  sequence: number | null
  stop_type: 'pickup' | 'delivery' | 'other' | null
  reason_code: string | null
  name: string | null
  address1: string | null
  address2: string | null
  city: string | null
  state: string | null
  postal: string | null
  country: string | null
  contact_name: string | null
  phone: string | null
  email: string | null
  metro_id: string | null
  earliest: string | null
  latest: string | null
  appointment: string | null
  appointment_number: string | null
  weight: number | null
  weight_uom: string | null
  quantity: number | null
  instructions: string | null
  actual_arrival: string | null
  actual_departure: string | null
  created_at: string
  updated_at: string
}

export interface LoadParty {
  id: string
  load_id: string
  role: 'shipper' | 'bill_to' | 'carrier'
  name: string | null
  address1: string | null
  address2: string | null
  city: string | null
  state: string | null
  postal: string | null
  country: string | null
  code: string | null
  contact_name: string | null
  phone: string | null
  email: string | null
  fax: string | null
}

export interface LoadCharge {
  id: string
  load_id: string
  description: string | null
  accessorial_code: string | null
  quantity: number | null
  rate: number | null
  amount: number | null
  side: 'customer' | 'carrier'
}

export interface LoadReference {
  id: string
  load_id: string
  stop_id: string | null
  qualifier: string | null
  value: string | null
  label: string | null
}

export interface LoadFlag {
  id: string
  load_id: string
  flag_type_id: string
  note: string | null
  created_by: string | null
  created_at: string
  resolved_at: string | null
  resolved_by: string | null
}

export interface LoadTrackingEvent {
  id: string
  load_id: string
  type: 'check_call' | 'tracking_ping' | 'dispatcher_note' | 'status_update'
  note: string | null
  location: string | null
  created_by: string | null
  created_at: string
}

export interface LoadStatusHistory {
  id: string
  load_id: string
  from_stage_id: string | null
  to_stage_id: string
  changed_by: string | null
  changed_at: string
  note: string | null
}

export interface LoadFieldEdit {
  id: string
  load_id: string
  field_key: string
  old_value: string | null
  new_value: string | null
  edited_by: string | null
  edited_at: string
}

export type InteractionAgeBucket = 'recent' | 'caution' | 'archive'

export interface CarrierInteraction {
  id: string
  carrier_id: string
  load_id: string | null
  interaction_type_id: string
  body: string
  created_by: string | null
  created_at: string
}

/** Row shape of `v_carrier_recent_interactions`. */
export interface CarrierInteractionView extends CarrierInteraction {
  age_bucket: InteractionAgeBucket
  interaction_type_key: string
  interaction_type_label: string
  severity: 'info' | 'warn' | 'critical'
  load_number: string | null
  created_by_name: string | null
}

export interface OrgSettings {
  id: number
  urgency_rules: unknown
  qc_bands: unknown
  interaction_aging: unknown
  created_at: string
  updated_at: string
}
