/**
 * Canonical field -> the 204 slot it lands in, plus human labels and the
 * groupings the review screen lays fields out in.
 *
 * Lifted from legacy/index.html L1813-1946 (the `View` IIFE) — the static data
 * maps only. The legacy HTML-string rendering (`row()`, `build()`) is
 * deliberately NOT ported: the new app renders with React.
 *
 * The constants are renamed on the way over (legacy name -> new name):
 *   SLOT           -> EDI_SLOTS
 *   STOP_SLOT      -> EDI_STOP_SLOTS
 *   LABELS         -> FIELD_LABELS
 *   GROUPS         -> FIELD_GROUPS
 *   STOP_FIELDS    -> STOP_FIELDS
 *   SLOT_MAP_ROWS  -> SLOT_MAP_ROWS
 * The values themselves are unchanged.
 */

/** Header-level field path -> the X12 204 element it maps to. */
export const EDI_SLOTS: Record<string, string> = {
  shipment_id:'B2-04', scac:'B2-02', method_of_payment:'B2-06', purpose:'B2A-01',
  tender_date:'G62-02 (hdr)',
  'shipper.name':'N1-02 (BT)', 'shipper.address1':'N3-01 (BT)',
  'shipper.city':'N4-01 (BT)', 'shipper.state':'N4-02 (BT)', 'shipper.postal':'N4-03 (BT)',
  'carrier.name':'MS3-01 / ref', mc_number:'L11 (ref)',
  'equipment.type_code':'N7-11', 'equipment.type_text':'-',
  'equipment.length_ft':'N7-24', 'equipment.initial':'N7-01', 'equipment.number':'N7-02',
  total_weight:'L3-01 / AT8-03', weight_uom:'L3-12 / AT8-02', commodity:'L5-02',
  distance_miles:'L11 (partner-defined)', total_charge:'L3-05', notes:'NTE-02 (hdr)',
  driver_name:'-', driver_phone:'-',
};

/** Stop-level field path -> the X12 204 element it maps to. */
export const EDI_STOP_SLOTS: Record<string, string> = {
  sequence:'S5-01', stop_type:'-', reason_code:'S5-02',
  'party.name':'N1-02', 'party.address1':'N3-01', 'party.address2':'N3-02',
  'party.city':'N4-01', 'party.state':'N4-02', 'party.postal':'N4-03',
  'party.country':'N4-04', 'party.code':'N1-04',
  'party.contact_name':'G61-02', 'party.phone':'G61-04', 'party.email':'G61-04 (EM)',
  earliest:'G62 (early)', latest:'G62 (late)', weight:'S5-03 / AT8-03',
  quantity:'S5-05 / OID-05', instructions:'NTE-02',
};

/** Field path -> the label a human sees on the review screen. */
export const FIELD_LABELS: Record<string, string> = {
  shipment_id:'Load / tender number', scac:'Carrier SCAC',
  method_of_payment:'Method of payment', purpose:'Transaction purpose',
  tender_date:'Tender date', 'shipper.name':'Tendering party',
  'shipper.address1':'Address', 'shipper.city':'City', 'shipper.state':'State',
  'shipper.postal':'ZIP', 'carrier.name':'Carrier', mc_number:'MC number',
  'equipment.type_code':'Equipment code', 'equipment.type_text':'Equipment (as printed)',
  'equipment.length_ft':'Trailer length (ft)', 'equipment.initial':'Trailer initial',
  'equipment.number':'Trailer number', total_weight:'Total weight',
  weight_uom:'Weight unit', commodity:'Commodity', distance_miles:'Distance (mi)',
  total_charge:'Total charge', notes:'Notes / special instructions',
  driver_name:'Driver', driver_phone:'Driver phone',
  sequence:'Stop #', stop_type:'Type', reason_code:'Stop reason code',
  'party.name':'Facility', 'party.address1':'Address 1', 'party.address2':'Address 2',
  'party.city':'City', 'party.state':'State', 'party.postal':'ZIP',
  'party.country':'Country', 'party.code':'Location code',
  'party.contact_name':'Contact', 'party.phone':'Phone', 'party.email':'Email',
  earliest:'Earliest', latest:'Latest', weight:'Weight', quantity:'Quantity',
  instructions:'Instructions',
};

/** [group title, field paths] — the order the review screen lays header fields out in. */
export type FieldGroup = [string, string[]];

export const FIELD_GROUPS: FieldGroup[] = [
  ['Order', ['shipment_id','tender_date','purpose','method_of_payment','scac']],
  ['Tendering party', ['shipper.name','shipper.address1','shipper.city','shipper.state','shipper.postal']],
  ['Equipment', ['equipment.type_code','equipment.type_text','equipment.length_ft',
                 'equipment.initial','equipment.number']],
  ['Freight', ['commodity','total_weight','weight_uom','distance_miles']],
  ['Money', ['total_charge']],
  ['Other', ['carrier.name','mc_number','notes','driver_name','driver_phone']],
];

/** Field paths shown for each stop, in order. */
export const STOP_FIELDS: string[] = ['stop_type','reason_code','party.name','party.address1',
  'party.address2','party.city','party.state','party.postal','party.country',
  'earliest','latest','quantity','weight','party.contact_name','party.phone','instructions'];

/** [field path, segment, element, description, required, partner-dependent] */
export type SlotMapRow = [string, string, string, string, boolean, boolean];

export const SLOT_MAP_ROWS: SlotMapRow[] = [
  ['shipment_id','B2','04','Shipment Identification Number',true,false],
  ['scac','B2','02','Standard Carrier Alpha Code',true,false],
  ['method_of_payment','B2','06','Shipment Method of Payment',true,false],
  ['purpose','B2A','01','Transaction Set Purpose Code',true,false],
  ['(constant LT)','B2A','02','Application Type = Load Tender',true,false],
  ['tender_date','G62','02','Date (hdr, qual 10 Requested Ship)',false,true],
  ['references[]','L11','01/02','Reference Number + Qualifier',false,true],
  ['notes','NTE','02','Header note text',false,true],
  ['carrier.name','MS3','01','Routing / SCAC',false,true],
  ['equipment.type_code','N7','11','Equipment Description Code',true,false],
  ['equipment.length_ft','N7','24','Equipment Length',false,true],
  ['equipment.initial','N7','01','Equipment Initial',false,false],
  ['equipment.number','N7','02','Equipment Number',false,false],
  ['total_weight','AT8','03','Header weight',false,false],
  ['weight_uom','AT8','02','Weight Unit Code (L/K)',false,false],
  ['shipper.name','N1','02','Header party (BT / SH)',false,true],
  ['stops[].sequence','S5','01','Stop Sequence Number',true,false],
  ['stops[].reason_code','S5','02','Stop Reason Code (LD/UL/CL/CU)',true,false],
  ['stops[].weight','S5','03','Weight at stop',false,false],
  ['stops[].quantity','S5','05','Number of Units at stop',false,false],
  ['stops[].references[]','L11','01/02','Stop reference (PO/BM/CN...)',false,true],
  ['stops[].earliest','G62','01-04','Earliest date + time',true,true],
  ['stops[].latest','G62','01-04','Latest date + time',false,true],
  ['stops[].party.name','N1','02','Stop party name (SF/ST)',true,false],
  ['stops[].party.code','N1','04','Location code',false,true],
  ['stops[].party.address1','N3','01','Address line 1',true,false],
  ['stops[].party.address2','N3','02','Address line 2',false,false],
  ['stops[].party.city','N4','01','City',true,false],
  ['stops[].party.state','N4','02','State / Province',true,false],
  ['stops[].party.postal','N4','03','Postal Code',true,false],
  ['stops[].party.country','N4','04','Country Code',false,false],
  ['stops[].party.contact_name','G61','02','Contact name',false,false],
  ['stops[].party.phone','G61','04','Contact number (qual TE)',false,false],
  ['stops[].instructions','NTE','02','Stop special instructions',false,true],
  ['stops[].items[].description','L5','02','Lading description',false,false],
  ['stops[].items[].po_number','OID','02','Purchase Order Number',false,false],
  ['stops[].items[].quantity','OID','05','Lading Quantity',false,false],
  ['total_weight','L3','01','Total weight',false,false],
  ['total_charge','L3','05','Total charge (implied decimals)',false,true],
  ['distance_miles','L11','01','Miles - partner-defined qualifier',false,true],
];

/**
 * @deprecated Legacy 3-tier banding from the single-file app (View.band,
 * legacy/index.html L1913-1918). The new app uses a configurable 4-tier band
 * defined elsewhere — this is kept only so old screens can be compared
 * against the original thresholds.
 */
export function legacyBand(conf: number, value: any): 'none' | 'high' | 'medium' | 'low' {
  if (value === null || value === undefined || value === '') return 'none';
  if (conf >= 0.9) return 'high';
  if (conf >= 0.7) return 'medium';
  return 'low';
}
