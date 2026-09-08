/**
 * X12 — segments, ISA/GS envelope, 204 load tender, 990 tender response,
 * and validation. Transaction-agnostic envelope so 210 / 214 are additive.
 *
 * Lifted verbatim from legacy/index.html L1085-1500 (the `EDI` IIFE), including
 * the partner defaults, every element position, every length cap and every
 * validation code string. Diff against the legacy file before changing
 * anything: partners certify against these exact outputs.
 */

import type { LoadTender, Party } from '@/types/tender';

export interface PartnerDelimiters {
  element: string;
  component: string;
  repetition: string;
  segment: string;
  suffix: string;
}

export interface PartnerEnvelope {
  isa_auth_qualifier: string;
  isa_auth_info: string;
  isa_security_qualifier: string;
  isa_security_info: string;
  isa_sender_qualifier: string;
  isa_receiver_qualifier: string;
  isa_sender_id: string;
  isa_receiver_id: string;
  gs_sender_id: string;
  gs_receiver_id: string;
  isa_version: string;
  ack_requested: string;
  usage_indicator: string;
  gs_functional_id: string;
  gs_version: string;
}

export interface PartnerOptions {
  money_implied_decimals: boolean;
  equipment_length_unit: string;
  send_header_l11_refs: boolean;
  send_stop_nte: boolean;
  max_nte_length: number;
  uppercase_text: boolean;
  date_qualifiers: Record<string, string>;
  time_qualifier: string;
  distance_ref_qualifier: string;
  header_party_code: string;
  pickup_party_code: string;
  delivery_party_code: string;
}

export interface PartnerConfig {
  name: string;
  description: string;
  our_scac: string;
  delimiters: PartnerDelimiters;
  envelope: PartnerEnvelope;
  options: PartnerOptions;
}

/** One X12 segment: a tag plus a sparse map of element position -> value. */
export interface Segment {
  tag: string;
  els: Record<number, any>;
}

export type IssueLevel = 'error' | 'warning' | 'info';

export interface EdiIssue {
  level: IssueLevel;
  code: string;
  message: string;
  segment: string;
}

export interface EdiIssueSummary {
  errors: EdiIssue[];
  warnings: EdiIssue[];
  info: EdiIssue[];
  transmittable: boolean;
}

export interface EnvelopeResult {
  text: string;
  meta: {
    isa_control: string;
    gs_control: string;
    usage_indicator: string;
    segment_count: number;
    generated_at: string;
  };
}

export const DEFAULT_PARTNERS: Record<string, PartnerConfig> = {
  truxco: {
    name: 'TRUXCO',
    description: 'Primary TMS / order entry. 204 inbound to their order queue.',
    our_scac: 'SOMA',
    delimiters: { element: '*', component: '>', repetition: '^', segment: '~', suffix: '\n' },
    envelope: {
      isa_auth_qualifier: '00', isa_auth_info: '', isa_security_qualifier: '00',
      isa_security_info: '', isa_sender_qualifier: 'ZZ', isa_receiver_qualifier: 'ZZ',
      isa_sender_id: 'SOLVIXLOG', isa_receiver_id: 'TRUXCO',
      gs_sender_id: 'SOLVIX', gs_receiver_id: 'TRUXCO',
      isa_version: '00401', ack_requested: '0', usage_indicator: 'T',
      gs_functional_id: 'SM', gs_version: '004010',
    },
    options: {
      money_implied_decimals: true,
      equipment_length_unit: 'inches',
      send_header_l11_refs: true,
      send_stop_nte: true,
      max_nte_length: 60,
      uppercase_text: true,
      date_qualifiers: { tender_date:'10', pickup_earliest:'37', pickup_latest:'38',
                         delivery_earliest:'53', delivery_latest:'54' },
      time_qualifier: 'I',
      distance_ref_qualifier: 'ZZ',
      header_party_code: 'BT',
      pickup_party_code: 'SF',
      delivery_party_code: 'ST',
    },
  },
  apex: {
    name: 'Apex Logistics Corp',
    description: 'Shipper. Receives our 990 response to their load tender.',
    our_scac: 'SOMA',
    delimiters: { element: '*', component: '>', repetition: '^', segment: '~', suffix: '\n' },
    envelope: {
      isa_auth_qualifier: '00', isa_auth_info: '', isa_security_qualifier: '00',
      isa_security_info: '', isa_sender_qualifier: 'ZZ', isa_receiver_qualifier: 'ZZ',
      isa_sender_id: 'SOLVIXLOG', isa_receiver_id: 'APEXLOG',
      gs_sender_id: 'SOLVIX', gs_receiver_id: 'APEXLOG',
      isa_version: '00401', ack_requested: '0', usage_indicator: 'T',
      gs_functional_id: 'SM', gs_version: '004010',
    },
    options: {
      money_implied_decimals: true, equipment_length_unit: 'inches',
      send_header_l11_refs: true, send_stop_nte: true, max_nte_length: 60,
      uppercase_text: true,
      date_qualifiers: { tender_date:'10', pickup_earliest:'37', pickup_latest:'38',
                         delivery_earliest:'53', delivery_latest:'54' },
      time_qualifier: 'I', distance_ref_qualifier: 'ZZ',
      header_party_code: 'BT', pickup_party_code: 'SF', delivery_party_code: 'ST',
    },
  },
};

/* Items a human must confirm against the partner's 204 implementation guide
   before flipping ISA15 to production. */
export const CONFIRM_ITEMS = (p: PartnerConfig): Array<[string, any]> => [
  ['ISA06 sender id', p.envelope.isa_sender_id],
  ['ISA08 receiver id', p.envelope.isa_receiver_id],
  ['GS02 / GS03', `${p.envelope.gs_sender_id} / ${p.envelope.gs_receiver_id}`],
  ['Our SCAC (B2-02)', p.our_scac],
  ['Money format in L3-05', p.options.money_implied_decimals ? 'implied 2 decimals' : 'explicit decimals'],
  ['N7-24 length unit', p.options.equipment_length_unit],
  ['G62 date qualifiers', Object.entries(p.options.date_qualifiers).map(([k, v]) => `${k}=${v}`).join(', ')],
  ['G62 time qualifier', p.options.time_qualifier],
  ['Miles reference qualifier', p.options.distance_ref_qualifier],
  ['Usage indicator (ISA15)', p.envelope.usage_indicator],
];

const seg = (tag: string, positions: Record<number, any>): Segment => {
  const els: Record<number, any> = {};
  for (const [k, v] of Object.entries(positions))
    if (v !== null && v !== undefined && v !== '') els[+k] = v;
  return { tag, els };
};

function render(s: Segment, esep: string, sterm: string, suffix: string): string {
  const keys = Object.keys(s.els).map(Number);
  if (!keys.length) return s.tag + sterm + suffix;
  const last = Math.max(...keys);
  const parts = [s.tag];
  for (let i = 1; i <= last; i++) parts.push(s.els[i] === undefined ? '' : String(s.els[i]));
  return parts.join(esep) + sterm + suffix;
}

const padRight = (v: any, w: number) => String(v ?? '').padEnd(w).slice(0, w);

const FOLD: Record<string, string> = { '’':"'", '‘':"'", '“':'"', '”':'"',
                                       '–':'-', '—':'-', ' ':' ', '°':'', '…':'...' };

/* X12 delimiters must never appear inside data, and the basic character set
   is ASCII uppercase — a smart quote out of a PDF fails some translators. */
export function clean(text: any, limit = 80, upper = true): string {
  if (text === null || text === undefined) return '';
  let t = String(text);
  for (const [bad, good] of Object.entries(FOLD)) t = t.split(bad).join(good);
  t = t.replace(/[^\x00-\x7F]/g, '');
  for (const ch of ['*', '~', '>', '^', '\n', '\r', '|']) t = t.split(ch).join(' ');
  t = t.split(/\s+/).filter(Boolean).join(' ');
  if (upper) t = t.toUpperCase();
  return t.slice(0, limit);
}

export const x12date = (v: any): string => {
  if (!v) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v));
  return m ? m[1] + m[2] + m[3] : '';
};
export const x12time = (v: any): string => {
  if (!v) return '';
  const m = /T(\d{2}):(\d{2})/.exec(String(v));
  return m ? m[1] + m[2] : '';
};
export const money = (v: any, implied?: any): string => {
  if (v === null || v === undefined || v === '') return '';
  const n = parseFloat(v);
  return implied ? String(Math.round(n * 100)) : n.toFixed(2);
};
const num = (v: any): string => {
  if (v === null || v === undefined || v === '') return '';
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return '';
  return Number.isInteger(n) ? String(n) : String(n);
};

function chunks(text: any, size: number): string[] {
  const words = String(text).split(/\s+/).filter(Boolean);
  const out = [];
  let cur = '';
  for (const w of words) {
    if (cur.length + w.length + 1 > size) { if (cur) out.push(cur); cur = w.slice(0, size); }
    else cur = (cur + ' ' + w).trim();
  }
  if (cur) out.push(cur);
  return out.slice(0, 5);
}

function partySegments(party: Party, entityCode: any, upper: any): Segment[] {
  const out: Segment[] = [];
  if (!(party.name.v || party.city.v)) return out;
  out.push(seg('N1', { 1: entityCode, 2: clean(party.name.v, 60, upper),
                       3: party.code.v ? '93' : '', 4: clean(party.code.v, 17, upper) }));
  if (party.address1.v)
    out.push(seg('N3', { 1: clean(party.address1.v, 55, upper), 2: clean(party.address2.v, 55, upper) }));
  if (party.city.v || party.postal.v)
    out.push(seg('N4', { 1: clean(party.city.v, 30, upper), 2: clean(party.state.v, 2, upper),
                         3: clean(party.postal.v, 15, upper), 4: clean(party.country.v, 3, upper) }));
  if (party.contact_name.v || party.phone.v)
    out.push(seg('G61', { 1: 'IC', 2: clean(party.contact_name.v, 60, upper) || 'CONTACT',
                          3: party.phone.v ? 'TE' : '', 4: clean(party.phone.v, 20, upper) }));
  if (party.email.v)
    out.push(seg('G61', { 1: 'IC', 2: clean(party.contact_name.v, 60, upper) || 'CONTACT',
                          3: 'EM', 4: clean(party.email.v, 60, upper) }));
  return out;
}

function equipmentLength(v: any, unit: any): string {
  if (v === null || v === undefined || v === '') return '';
  const ft = parseInt(v, 10);
  if (unit === 'inches') return String(ft * 12);
  if (unit === 'feet_x100') return String(ft * 100);
  return String(ft);
}

export function build204(t: LoadTender, p: PartnerConfig, stControl = '0001'): Segment[] {
  const o: any = p.options, dq = o.date_qualifiers || {}, tq = o.time_qualifier || 'I';
  const implied = !!o.money_implied_decimals, up = o.uppercase_text !== false;
  const scac = t.scac.v || p.our_scac;
  const segs: Segment[] = [];

  segs.push(seg('ST', { 1: '204', 2: stControl }));
  segs.push(seg('B2', { 2: clean(scac, 4, up), 4: clean(t.shipment_id.v, 30, up),
                        6: t.method_of_payment.v || 'PP' }));
  segs.push(seg('B2A', { 1: t.purpose.v || '00', 2: 'LT' }));

  if (o.send_header_l11_refs !== false) {
    if (t.shipment_id.v) segs.push(seg('L11', { 1: clean(t.shipment_id.v, 30, up), 2: 'OQ' }));
    for (const r of t.references)
      if (r.value.v) segs.push(seg('L11', { 1: clean(r.value.v, 30, up), 2: r.qualifier.v || 'ZZ' }));
    if (t.distance_miles.v)
      segs.push(seg('L11', { 1: String(Math.round(t.distance_miles.v as number)), 2: o.distance_ref_qualifier || 'ZZ' }));
  }
  if (t.tender_date.v)
    segs.push(seg('G62', { 1: dq.tender_date || '10', 2: x12date(t.tender_date.v) }));
  segs.push(seg('MS3', { 1: clean(scac, 4, up), 2: 'B', 4: 'M' }));
  if (t.notes.v)
    for (const ch of chunks(clean(t.notes.v, 400, up), o.max_nte_length || 60))
      segs.push(seg('NTE', { 1: 'OTH', 2: ch }));

  const eq = t.equipment;
  if (eq.type_code.v || eq.number.v)
    segs.push(seg('N7', { 1: clean(eq.initial.v, 4, up), 2: clean(eq.number.v, 10, up),
                          11: eq.type_code.v || '',
                          24: equipmentLength(eq.length_ft.v, o.equipment_length_unit || 'inches') }));

  if (t.shipper.name.v) segs.push(...partySegments(t.shipper, o.header_party_code || 'BT', up));

  for (const st of t.stops) {
    const isPickup = String(st.stop_type.v).startsWith('pick');
    segs.push(seg('S5', { 1: st.sequence.v, 2: st.reason_code.v || (isPickup ? 'CL' : 'CU'),
                          3: num(st.weight.v), 4: st.weight_uom.v || (st.weight.v ? 'L' : ''),
                          5: num(st.quantity.v), 6: st.quantity.v ? 'PL' : '' }));
    for (const r of st.references)
      if (r.value.v) segs.push(seg('L11', { 1: clean(r.value.v, 30, up), 2: r.qualifier.v || 'ZZ' }));

    const earlyQ = isPickup ? (dq.pickup_earliest || '37') : (dq.delivery_earliest || '53');
    const lateQ = isPickup ? (dq.pickup_latest || '38') : (dq.delivery_latest || '54');
    for (const [value, qual] of [[st.earliest.v, earlyQ], [st.latest.v, lateQ]]) {
      if (!value) continue;
      const d = x12date(value), tm = x12time(value);
      segs.push(seg('G62', { 1: qual, 2: d, 3: tm ? tq : '', 4: tm }));
    }
    if (st.weight.v)
      segs.push(seg('AT8', { 1: 'G', 2: st.weight_uom.v || 'L', 3: num(st.weight.v), 4: num(st.quantity.v) }));

    segs.push(...partySegments(st.party,
      isPickup ? (o.pickup_party_code || 'SF') : (o.delivery_party_code || 'ST'), up));

    if (st.instructions.v && o.send_stop_nte !== false)
      for (const ch of chunks(clean(st.instructions.v, 250, up), o.max_nte_length || 60))
        segs.push(seg('NTE', { 1: 'OTH', 2: ch }));

    const items: any[] = st.items || [];
    if (!items.length && isPickup && (t.commodity.v || st.quantity.v)) {
      const po = [...st.references, ...t.references].find(r => r.qualifier.v === 'PO');
      segs.push(seg('OID', { 1: clean(t.shipment_id.v, 30, up), 2: clean(po ? po.value.v : '', 22, up),
                             5: num(st.quantity.v), 6: st.weight_uom.v || 'L', 7: num(st.weight.v) }));
      if (t.commodity.v) segs.push(seg('L5', { 1: '1', 2: clean(t.commodity.v, 50, up) }));
    }
    items.forEach((it: any, idx: number) => {
      segs.push(seg('OID', { 1: clean(t.shipment_id.v, 30, up), 2: clean(it.po_number?.v, 22, up),
                             4: it.packaging?.v || '', 5: num(it.quantity?.v),
                             6: it.weight_uom?.v || 'L', 7: num(it.weight?.v) }));
      segs.push(seg('L5', { 1: String(idx + 1), 2: clean(it.description?.v, 50, up),
                            3: it.nmfc?.v || '', 4: it.nmfc?.v ? 'N' : '' }));
    });
  }

  const totalQty = t.stops.filter(s => String(s.stop_type.v).startsWith('pick'))
                          .reduce((a, s) => a + ((s.quantity.v as number) || 0), 0);
  segs.push(seg('L3', { 1: num(t.total_weight.v), 2: t.total_weight.v ? 'G' : '',
                        5: t.total_charge.v ? money(t.total_charge.v, implied) : '',
                        11: totalQty ? String(totalQty) : '', 12: t.weight_uom.v || 'L' }));
  segs.push(seg('SE', { 1: segs.length + 1, 2: stControl }));
  return segs;
}

export function build990(
  shipmentId: any,
  scac: any,
  action: any,
  dateIso: any,
  reason?: any,
  references?: any,
  stControl = '0001',
): Segment[] {
  const segs = [seg('ST', { 1: '990', 2: stControl })];
  segs.push(seg('B1', { 1: clean(scac, 4), 2: clean(shipmentId, 30), 3: x12date(dateIso), 4: action }));
  for (const [qual, val] of (references || [])) segs.push(seg('N9', { 1: qual, 2: clean(val, 30) }));
  if (reason) segs.push(seg('K1', { 1: clean(reason, 60) }));
  segs.push(seg('SE', { 1: segs.length + 1, 2: stControl }));
  return segs;
}

export function wrap(
  segsIn: Segment[],
  p: PartnerConfig,
  controls: { isa: any; gs: any },
  functionalId?: any,
  now?: any,
): EnvelopeResult {
  const d = p.delimiters, env: any = p.envelope;
  now = now || new Date();
  const yy = String(now.getFullYear()).slice(2), MM = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0'), mi = String(now.getMinutes()).padStart(2, '0');
  const isaCtl = String(controls.isa).padStart(9, '0');
  const gsCtl = String(controls.gs);

  const isa = seg('ISA', {
    1: env.isa_auth_qualifier || '00', 2: padRight(env.isa_auth_info, 10),
    3: env.isa_security_qualifier || '00', 4: padRight(env.isa_security_info, 10),
    5: env.isa_sender_qualifier || 'ZZ', 6: padRight(env.isa_sender_id, 15),
    7: env.isa_receiver_qualifier || 'ZZ', 8: padRight(env.isa_receiver_id, 15),
    9: yy + MM + dd, 10: hh + mi, 11: d.repetition, 12: env.isa_version || '00401',
    13: isaCtl, 14: env.ack_requested || '0', 15: env.usage_indicator || 'T',
    16: d.component,
  });
  const gs = seg('GS', {
    1: functionalId || env.gs_functional_id || 'SM', 2: env.gs_sender_id, 3: env.gs_receiver_id,
    4: `${now.getFullYear()}${MM}${dd}`, 5: hh + mi, 6: gsCtl, 7: 'X', 8: env.gs_version || '004010',
  });
  const all = [isa, gs, ...segsIn,
    seg('GE', { 1: 1, 2: gsCtl }), seg('IEA', { 1: 1, 2: isaCtl })];
  const text = all.map(s => render(s, d.element, d.segment, d.suffix ?? '\n')).join('');
  return { text, meta: { isa_control: isaCtl, gs_control: gsCtl,
           usage_indicator: env.usage_indicator, segment_count: all.length,
           generated_at: now.toISOString().slice(0, 19) } };
}

/* ------------------------------------------------------------ validation */
const ERROR: IssueLevel = 'error', WARNING: IssueLevel = 'warning', INFO: IssueLevel = 'info';
const REQUIRED_204 = ['ST','B2','B2A','S5','N1','N3','N4','SE'];
const REQUIRED_990 = ['ST','B1','SE'];
const MAX_LEN: Record<string, number> = { 'B2|2':4, 'B2|4':30, 'N1|2':60, 'N3|1':55, 'N3|2':55, 'N4|1':30,
                  'N4|2':2, 'N4|3':15, 'N4|4':3, 'L11|1':30, 'L11|2':3, 'NTE|2':80,
                  'G61|2':60, 'G61|4':80 };
const VALID_STOP_REASON = new Set(['LD','UL','CL','CU','PL','PU','RL','RU']);
const VALID_PURPOSE = new Set(['00','01','04','05']);
const VALID_PAYMENT = new Set(['PP','CC','TP','PC','PU','MX']);

export function parseSegments(text: string, esep = '*', sterm = '~'): Array<{ tag: string; parts: string[] }> {
  return text.replace(/\r/g, '').split(sterm)
    .map(s => s.replace(/^\n+|\n+$/g, '').trim())
    .filter(Boolean)
    .map(raw => { const parts = raw.split(esep); return { tag: parts[0], parts: [parts[0], ...parts.slice(1)] }; })
    .map(s => ({ tag: s.tag, parts: s.parts }));
}

export function validate(text: string, p: PartnerConfig | null | undefined, transaction = '204'): EdiIssue[] {
  const d = (p && p.delimiters) || { element: '*', segment: '~' };
  const segs = parseSegments(text, d.element, d.segment);
  const tags = segs.map(s => s.tag);
  const issues: EdiIssue[] = [];
  const add = (level: IssueLevel, code: string, message: string, segment = '') =>
    issues.push({ level, code, message, segment });
  const f = (parts: any, i: number) => (parts && parts[i] !== undefined ? parts[i] : '');
  const find = (tag: string) => segs.filter(s => s.tag === tag).map(s => s.parts);

  const isa = find('ISA')[0], iea = find('IEA')[0], gs = find('GS')[0], ge = find('GE')[0];
  if (!isa || !iea) add(ERROR, 'ENV001', 'Interchange is missing ISA and/or IEA.');
  else if (f(isa, 13) !== f(iea, 2)) add(ERROR, 'ENV002', `ISA13 ${f(isa,13)} != IEA02 ${f(iea,2)}.`, 'IEA');
  if (!gs || !ge) add(ERROR, 'ENV003', 'Interchange is missing GS and/or GE.');
  else if (f(gs, 6) !== f(ge, 2)) add(ERROR, 'ENV004', `GS06 ${f(gs,6)} != GE02 ${f(ge,2)}.`, 'GE');
  if (isa && f(isa, 15) === 'T')
    add(INFO, 'ENV005', 'ISA15 = T (test). Flip to P in Partner settings when the partner certifies the connection.');

  const st = find('ST')[0], se = find('SE')[0];
  if (st && se) {
    if (f(st, 2) !== f(se, 2)) add(ERROR, 'ENV006', `ST02 ${f(st,2)} != SE02 ${f(se,2)}.`, 'SE');
    const start = tags.indexOf('ST'), end = tags.indexOf('SE');
    const actual = end - start + 1;
    if (parseInt(f(se, 1) || '0', 10) !== actual)
      add(ERROR, 'ENV007', `SE01 says ${f(se,1)} segments, interchange contains ${actual}.`, 'SE');
    if (transaction && f(st, 1) !== transaction)
      add(ERROR, 'ENV008', `ST01 is ${f(st,1)}, expected ${transaction}.`, 'ST');
  }
  for (const tag of (transaction === '204' ? REQUIRED_204 : REQUIRED_990))
    if (!tags.includes(tag)) add(ERROR, 'REQ001', `Required segment ${tag} is missing.`, tag);

  for (const s of segs)
    for (const [key, limit] of Object.entries(MAX_LEN)) {
      const [t2, idx] = key.split('|');
      if (s.tag === t2 && f(s.parts, +idx).length > limit)
        add(ERROR, 'LEN001', `${t2}${String(idx).padStart(2,'0')} is ${f(s.parts,+idx).length} chars, max ${limit}.`, t2);
    }

  if (transaction === '204') {
    const b2 = find('B2')[0];
    if (b2) {
      if (!f(b2, 4)) add(ERROR, 'B2001', 'B2-04 shipment identification number is empty.', 'B2');
      const scac = f(b2, 2);
      if (!/^[A-Z]{2,4}$/.test(scac || '')) add(ERROR, 'B2002', `B2-02 SCAC '${scac}' must be 2-4 uppercase letters.`, 'B2');
      if (f(b2, 6) && !VALID_PAYMENT.has(f(b2, 6)))
        add(WARNING, 'B2003', `B2-06 '${f(b2,6)}' is not a common method-of-payment code.`, 'B2');
    }
    const b2a = find('B2A')[0];
    if (b2a && !VALID_PURPOSE.has(f(b2a, 1)))
      add(ERROR, 'B2A01', `B2A-01 purpose '${f(b2a,1)}' invalid (00/01/04/05).`, 'B2A');

    const stops = find('S5');
    if (!stops.length) add(ERROR, 'S5001', 'No S5 stop loops - a 204 needs at least a pickup and a drop.', 'S5');
    const seqs: number[] = []; let loads = 0, unloads = 0;
    for (const s of stops) {
      const n = parseInt(f(s, 1), 10);
      if (Number.isNaN(n)) add(ERROR, 'S5002', `S5-01 '${f(s,1)}' is not numeric.`, 'S5');
      else seqs.push(n);
      const reason = f(s, 2);
      if (!VALID_STOP_REASON.has(reason)) add(ERROR, 'S5003', `S5-02 stop reason '${reason}' is not valid.`, 'S5');
      if (['LD','CL','PL'].includes(reason)) loads++;
      if (['UL','CU','PU'].includes(reason)) unloads++;
    }
    const sorted = [...seqs].sort((a, b) => a - b);
    if (seqs.length && seqs.join() !== sorted.join())
      add(ERROR, 'S5004', `Stop sequence numbers are not ascending: ${seqs.join(', ')}.`, 'S5');
    if (stops.length && !loads) add(ERROR, 'S5006', 'No load stop (LD/CL/PL) in the tender.', 'S5');
    if (stops.length && !unloads) add(ERROR, 'S5007', 'No unload stop (UL/CU/PU) in the tender.', 'S5');

    const times = [];
    for (const s of segs) {
      if (s.tag !== 'G62') continue;
      const dt = f(s.parts, 2), tm = f(s.parts, 4);
      if (dt && !/^\d{8}$/.test(dt)) { add(ERROR, 'G62001', `G62-02 '${dt}' must be CCYYMMDD.`, 'G62'); continue; }
      if (tm && !/^\d{4}$/.test(tm)) { add(ERROR, 'G62002', `G62-04 '${tm}' must be HHMM.`, 'G62'); continue; }
      if (dt) times.push(dt + (tm || '0000'));
    }
    const tsorted = [...times].sort();
    if (times.length && times.join() !== tsorted.join())
      add(WARNING, 'G62004', 'Stop date/times are not in chronological order - check the routing.', 'G62');

    for (const s of segs) {
      if (s.tag !== 'N4') continue;
      const state = f(s.parts, 2), zip = f(s.parts, 3);
      if (state && !/^[A-Z]{2}$/.test(state)) add(ERROR, 'N4001', `N4-02 state '${state}' must be 2 letters.`, 'N4');
      if (zip && !/^(\d{5}(-?\d{4})?|[A-Z]\d[A-Z]\d[A-Z]\d)$/.test(zip))
        add(WARNING, 'N4002', `N4-03 postal code '${zip}' looks malformed.`, 'N4');
    }

    const n7 = find('N7')[0];
    if (!n7) add(WARNING, 'N7001', 'No N7 equipment segment - most partners require equipment type on a tender.', 'N7');
    else if (!f(n7, 11)) add(WARNING, 'N7002', 'N7-11 equipment description code is empty.', 'N7');
    else if (!f(n7, 2)) add(INFO, 'N7003', 'N7-02 equipment number is empty (trailer not yet assigned). Some partners require it.', 'N7');

    if (!tags.includes('L3')) add(WARNING, 'L3001', 'No L3 totals segment.', 'L3');
  }
  return issues;
}

export const summarize = (issues: EdiIssue[]): EdiIssueSummary => ({
  errors: issues.filter(i => i.level === ERROR),
  warnings: issues.filter(i => i.level === WARNING),
  info: issues.filter(i => i.level === INFO),
  transmittable: !issues.some(i => i.level === ERROR),
});
