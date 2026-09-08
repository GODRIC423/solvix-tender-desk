/**
 * Pipeline — grid + parsers -> one canonical LoadTender, then derived codes
 * and sanity checks. Same shape as the Python engine so the two agree.
 *
 * Lifted verbatim from legacy/index.html L693-1078 (the `Pipeline` IIFE).
 * Behavior is unchanged, including the confidence weights, the inference
 * fallbacks and the warning strings. Diff against the legacy file before
 * changing anything.
 */

import type { LoadTender, Party, Stop } from '@/types/tender';
import * as P from './parsers';

const F = P.F;

/**
 * NOTE: the report rows this module emits use the legacy key names
 * (`path` / `value` / `confidence` / `source`), which do NOT match the
 * `ConfidenceReport` interface in `@/types/tender` (`key` / `v` / `c`).
 * The runtime shape is preserved as-is; the accurate types live here.
 */
export interface ConfidenceField {
  path: string;
  value: unknown;
  confidence: number;
  source: string;
}

export interface EngineConfidenceReport {
  fields: ConfidenceField[];
  needsReview: ConfidenceField[];
  score: number;
}

export function emptyParty(): Party {
  return { name:F(), address1:F(), address2:F(), city:F(), state:F(), postal:F(),
           country:F(), code:F(), contact_name:F(), phone:F(), email:F(), fax:F() };
}
export function emptyTender(): LoadTender {
  return {
    shipment_id:F(), purpose:F('00',1,'derived'), scac:F(),
    method_of_payment:F('PP',0.5,'derived'), tender_date:F(),
    shipper:emptyParty(), bill_to:emptyParty(), carrier:emptyParty(), mc_number:F(),
    equipment:{ type_code:F(), type_text:F(), length_ft:F(), initial:F(),
                number:F(), temp_min:F(), temp_max:F() },
    total_weight:F(), weight_uom:F('L',0.6,'derived'), commodity:F(),
    distance_miles:F(), total_quantity:F(), hazmat:F(),
    total_charge:F(), currency:F('USD',0.6,'derived'), charges:[],
    stops:[], references:[], notes:F(), terms:F(), driver_name:F(), driver_phone:F(),
    source_file:'', source_kind:'', extracted_at:new Date().toISOString().slice(0,19),
    warnings:[],
  };
}
export function emptyStop(): Stop {
  return { sequence:F(), stop_type:F(), reason_code:F(), party:emptyParty(),
           earliest:F(), latest:F(), appointment:F(), appointment_number:F(),
           weight:F(), weight_uom:F(), quantity:F(), instructions:F(),
           references:[], items:[] };
}

/* -------------------------------------------------------------- stops */
export function extractStops(lines: any[], defaultYear?: any): Stop[] {
  const [secStart, secEnd] = P.stopSectionBounds(lines);
  const lo = secStart !== null ? secStart + 1 : 0;
  const hi = secEnd !== null ? secEnd : lines.length;

  let anchors: any[] = [];
  for (let i = lo; i < Math.min(hi, lines.length); i++)
    for (const c of lines[i].cells)
      if (P.CITY_STATE_ZIP.test((c as any).text.trim())) { anchors.push([i, c]); break; }
  if (!anchors.length && secStart !== null) {
    for (let i = 0; i < lines.length; i++)
      for (const c of lines[i].cells)
        if (P.CITY_STATE_ZIP.test((c as any).text.trim())) { anchors.push([i, c]); break; }
  }
  if (!anchors.length) return [];

  const groups: any[] = [], used = new Set();
  for (const [li, anchor] of anchors) {
    let startIdx = li, found = false;
    for (let j = li; j > Math.max(li - 6, lo - 1); j--) {
      if (used.has(j)) break;
      if (j < li && lines[j].cells.some((c: any) => P.CITY_STATE_ZIP.test(c.text.trim()))) {
        startIdx = j + 1; found = true; break;
      }
      const first = lines[j].cells[0];
      if (first && P.STOP_START.test(first.text.trim())) { startIdx = j; found = true; }
    }
    if (!found) startIdx = Math.max(li - 2, lo);

    let endIdx = li;
    for (let k = li + 1; k < Math.min(hi, lines.length) && k <= li + 3; k++) {
      const nxt = lines[k];
      if (!nxt.cells.length) break;
      if (nxt.cells.some((c: any) => P.CITY_STATE_ZIP.test(c.text.trim()))) break;
      if (P.STOP_START.test(nxt.cells[0].text.trim())) break;
      if (!nxt.cells.some((c: any) => Math.abs(c.x0 - anchor.x0) < 35)) break;
      endIdx = k;
    }
    for (let j = startIdx; j <= endIdx; j++) used.add(j);
    groups.push([startIdx, endIdx, anchor]);
  }

  return groups.map(([a, b, anchor], i) => {
    const cells: any[] = [];
    for (let j = a; j <= b; j++) cells.push(...lines[j].cells);
    return buildStop(i + 1, cells, anchor, defaultYear);
  });
}

function buildStop(seq: number, cells: any[], anchor: any, defaultYear?: any): Stop {
  const st = emptyStop();
  st.sequence = F(seq, 0.95, 'derived');
  if (!cells.length) return st;
  const conf = Math.min(...cells.map(c => c.conf ?? 0.8));

  const minX = Math.min(...cells.map(c => c.x0));
  const typeCells = cells.filter(c => c.x0 - minX < 35);
  const typeTxt = typeCells.map(c => c.text).join(' ');
  const blob = cells.map(c => c.text).join(' | ');

  const classify = (t: any) => {
    const pu = P.PICKUP_WORDS.test(t), dl = P.DELIVER_WORDS.test(t);
    if (pu && !dl) return 'pickup';
    if (dl && !pu) return 'delivery';
    return null;
  };
  const kind = classify(typeTxt) || classify(blob);
  st.stop_type = kind
    ? F(kind, Math.min(0.95, 0.8 * conf + 0.15), 'derived', typeTxt.slice(0, 80))
    : F('unknown', 0.3, 'derived', typeTxt.slice(0, 80));

  const band = cells.filter(c => Math.abs(c.x0 - anchor.x0) < 40)
                    .sort((x, y) => x.top - y.top || x.x0 - y.x0);
  const m = P.CITY_STATE_ZIP.exec(anchor.text.trim());
  const p = st.party;
  if (m) {
    const g: any = m.groups;
    p.city = F(title(g.city.trim()), conf, 'parsed', anchor.text);
    p.state = F(g.state.toUpperCase(), conf, 'parsed', anchor.text);
    p.postal = F(g.zip.toUpperCase().replace(/ /g, ''), conf, 'parsed', anchor.text);
  }
  const above = band.filter(c => c.bottom <= anchor.top + 1);
  const below = band.filter(c => c.top >= anchor.bottom - 1);
  const streetRx = /^\s*\d|\b(st|street|ave|avenue|rd|road|dr|drive|blvd|way|pkwy|parkway|hwy|highway|ln|lane|ct|court|ste|suite|unit|box)\b/i;
  const street = above.filter(c => streetRx.test(c.text) && !P.isTimeish(c.text));
  const names = above.filter(c => !street.includes(c) && !P.isTimeish(c.text));
  if (street.length) {
    p.address1 = F(P.cleanLine(street[0].text), conf, 'parsed', street[0].text);
    if (street.length > 1) p.address2 = F(P.cleanLine(street[1].text), conf * 0.9, 'parsed');
  }
  if (names.length) p.name = F(P.cleanLine(names[0].text), conf, 'parsed', names[0].text);
  else if (above.length) p.name = F(P.cleanLine(above[0].text), conf * 0.8, 'parsed');
  const CC: Record<string, string> = { usa:'US', us:'US', 'u.s.a.':'US', canada:'CA', ca:'CA', mx:'MX', mexico:'MX' };
  for (const c of below) {
    const cc = CC[c.text.trim().toLowerCase()];
    if (cc) p.country = F(cc, conf, 'parsed');
  }
  if (!p.country.v) p.country = F('US', 0.72, 'derived', 'assumed domestic');

  const whenCells = cells.filter(c => !band.includes(c) &&
    (P.parseDate(c.text) || P.parseTimes(c.text).length));
  const whenTxt = (whenCells.length ? whenCells : cells.filter(c =>
    P.parseDate(c.text) || P.parseTimes(c.text).length)).map(c => c.text).join(' ');
  const [e, l] = P.parseWindow(whenTxt, defaultYear);
  if (e) st.earliest = F(e, conf, 'parsed', whenTxt);
  if (l) { st.latest = F(l, conf, 'parsed', whenTxt); st.appointment = F(true, 0.8, 'derived', 'window given'); }

  for (const c of cells) {
    if (band.includes(c)) continue;
    const ph = P.PHONE_RE.exec(c.text);
    if (ph && !p.phone.v) p.phone = F(P.normPhone(ph[0]), conf, 'parsed', c.text);
    const em = P.EMAIL_RE.exec(c.text);
    if (em && !p.email.v) p.email = F(em[0], conf, 'parsed', c.text);
    const cn = /(?:primary\s+)?contact\s*:?\s*([A-Z][A-Za-z.'\-]+(?:\s+[A-Z][A-Za-z.'\-]+)+)/.exec(c.text);
    if (cn && !p.contact_name.v) p.contact_name = F(cn[1].trim(), conf * 0.9, 'parsed', c.text);
  }

  const instr: any[] = [];
  for (const c of cells) {
    if (band.includes(c) || whenCells.includes(c) || typeCells.includes(c)) continue;
    const t = c.text.trim();
    if (!t || P.isTimeish(t) || P.parseDate(t) || P.PHONE_RE.test(t) || P.EMAIL_RE.test(t)) continue;
    if (/^(primary\s+)?contact:?$/i.test(t)) continue;
    if (typeCells.some(tc => tc.text === t)) continue;
    instr.push(t);
  }
  if (instr.length) st.instructions = F(instr.join('; ').slice(0, 250), conf * 0.9, 'parsed');
  st.references = P.harvestReferences(instr.join(' '));
  const q = /\b(\d{1,4})\s*(pallets?|plt|skids?|cases?|pieces?|pcs)\b/i.exec(instr.join(' '));
  if (q) st.quantity = F(parseInt(q[1], 10), conf * 0.9, 'parsed', q[0]);
  return st;
}

export const title = (s: any) => s.replace(/\w\S*/g, (w: string) => w[0].toUpperCase() + w.slice(1).toLowerCase());
const trim = (s: any) => String(s || '').replace(/\s{2,}/g, ' ').replace(/^[\s:|,\-]+|[\s:|,\-]+$/g, '');

/* ------------------------------------------------------------- header */
export function extractRules(lines: any[], docText?: any): LoadTender {
  const t = emptyTender();
  const cellsByLine = lines.map(l => l.cells);
  const flat = lines.map(l => l.text).join('\n') + '\n' + (docText || '');
  const lab = (keys: string[], gap = 0, validator: any = null) =>
    P.findLabeled(cellsByLine, keys, gap, validator);

  const hasDigits = (v: any) => /\d/.test(v || '');
  const isDate = (v: any) => P.parseDate(v || '') !== null;
  const isCompany = (v: any) => {
    v = String(v || '').trim();
    return /^[A-Za-z0-9]/.test(v) && v.length >= 3 && v.length <= 60 &&
           !/^(the|this|and|for)\b/i.test(v);
  };
  const isPerson = (v: any) => /^[A-Z][A-Za-z.'\-]+(?: [A-Z][A-Za-z.'\-]+){0,3}$/.test(String(v || '').trim());

  let [v, c, raw] = lab(P.LABELS.shipment_id, 0,
    (x: any) => /[A-Z0-9][A-Z0-9\-/]{3,}/.test(String(x || '').toUpperCase()));
  if (v) {
    const m = /[A-Z0-9][A-Z0-9\-/]{3,24}/.exec(v.toUpperCase());
    t.shipment_id = F(m ? m[0] : v.trim(), c, 'parsed', raw);
  }

  [v, c, raw] = lab(P.LABELS.tender_date, 0, isDate);
  const d = P.parseDate(v || '');
  if (d) t.tender_date = F(`${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`, c, 'parsed', raw);
  const year = d ? d.y : new Date().getFullYear();

  [v, c, raw] = lab(P.LABELS.shipper_name, 0, isCompany);
  if (v) t.shipper.name = F(trim(v), c, 'parsed', raw);
  [v, c, raw] = lab(P.LABELS.carrier_name, 0, isCompany);
  if (v) t.carrier.name = F(trim(v), c * 0.9, 'parsed', raw);
  [v, c, raw] = lab(P.LABELS.mc_number, 0, hasDigits);
  if (v) { const m = /(MC)?\s*(\d{4,8})/.exec(v.toUpperCase()); if (m) t.mc_number = F('MC' + m[2], c, 'parsed', raw); }
  [v, c, raw] = lab(P.LABELS.scac);
  if (v && /^[A-Z]{2,4}$/.test(v.trim().toUpperCase())) t.scac = F(v.trim().toUpperCase(), c, 'parsed', raw);

  if (!t.carrier.name.v) {
    for (let i = 0; i < lines.length - 1; i++) {
      if (/carrier (information|details)/i.test(lines[i].text) && lines[i + 1].cells.length) {
        const nxt = lines[i + 1].cells[0].text;
        if (nxt) t.carrier.name = F(trim(nxt), 0.85, 'parsed', nxt);
        break;
      }
    }
  }

  [v, c, raw] = lab(P.LABELS.equipment_text);
  if (v) {
    t.equipment.type_text = F(trim(v), c, 'parsed', raw);
    const [code, desc] = P.equipmentCode(v);
    if (code) t.equipment.type_code = F(code, c * 0.95, 'derived', desc || v);
    const lm = /\b(\d{2})\s*'|\b(\d{2})\s*(ft|foot|feet)\b/i.exec(v);
    if (lm) t.equipment.length_ft = F(parseInt(lm[1] || lm[2], 10), c, 'parsed', v);
  }
  [v, c, raw] = lab(P.LABELS.equipment_length, 0, hasDigits);
  if (v && !t.equipment.length_ft.v) {
    const lm = /(\d{2})/.exec(v);
    if (lm) t.equipment.length_ft = F(parseInt(lm[1], 10), c, 'parsed', raw);
  }

  [v, c, raw] = lab(P.LABELS.total_weight, 0, hasDigits);
  const [w, uom] = P.parseWeight(v || '');
  if (w) { t.total_weight = F(w, c, 'parsed', raw); t.weight_uom = F(uom, c, 'derived', raw); }

  [v, c, raw] = lab(P.LABELS.commodity, 0, isCompany);
  if (v) t.commodity = F(trim(v).slice(0, 80), c, 'parsed', raw);

  [v, c, raw] = lab(P.LABELS.distance_miles, 0, hasDigits);
  if (v) { const m = /([\d,]+)/.exec(v); if (m) t.distance_miles = F(parseFloat(m[1].replace(/,/g, '')), c, 'parsed', raw); }

  [v, c, raw] = lab(P.LABELS.notes);
  if (v && v.length > 3) t.notes = F(trim(v).slice(0, 400), c, 'parsed', raw);

  [v, c, raw] = lab(P.LABELS.driver_name, 0, isPerson);
  if (v && !/cell|phone/i.test(v)) t.driver_name = F(trim(v).slice(0, 40), c * 0.8, 'parsed', raw);
  [v, c, raw] = lab(P.LABELS.driver_phone, 0, hasDigits);
  if (v) { const ph = P.PHONE_RE.exec(v); if (ph) t.driver_phone = F(P.normPhone(ph[0]), c, 'parsed', raw); }

  t.stops = extractStops(lines, year);
  letterheadParties(t, lines);

  const [charges, total] = P.extractCharges(lines);
  t.charges = charges;
  if (total) t.total_charge = F(total[0], total[1], 'parsed', String(total[2]));

  const refs = P.harvestReferences(flat);
  const stopRefVals = new Set(t.stops.flatMap(s => s.references.map(r => r.value.v)));
  t.references = refs.filter(r => !stopRefVals.has(r.value.v) &&
                                  r.value.v !== t.shipment_id.v);
  return t;
}

/* Many tenders never write "Shipper:" — the tendering party is simply the
   letterhead, and the carrier sits under a "Carrier Information" heading. */
function letterheadParties(t: LoadTender, lines: any[]): void {
  const [secStart] = P.stopSectionBounds(lines);
  const limit = secStart !== null ? secStart : lines.length;
  let carrierHdr = null;
  for (let i = 0; i < limit; i++)
    if (/^\s*carrier\s+(information|details|info)\s*$/i.test(lines[i].text)) { carrierHdr = i; break; }

  const anchors: any[] = [];
  for (let i = 0; i < limit; i++)
    for (const c of lines[i].cells)
      if (P.CITY_STATE_ZIP.test((c as any).text.trim())) { anchors.push([i, c]); break; }

  const blockAt = (idx: number, cell: any) => {
    const band: any[] = [];
    for (let j = Math.max(idx - 4, 0); j < idx; j++)
      for (const c of lines[j].cells)
        if (Math.abs((c as any).x0 - cell.x0) < 45) band.push(c);
    return band;
  };
  const fill = (party: Party, idx: number, cell: any) => {
    const m = P.CITY_STATE_ZIP.exec(cell.text.trim());
    if (!m) return;
    const g: any = m.groups;
    if (!party.city.v) {
      party.city = F(title(g.city.trim()), cell.conf, 'letterhead');
      party.state = F(g.state.toUpperCase(), cell.conf, 'letterhead');
      party.postal = F(g.zip.toUpperCase().replace(/ /g, ''), cell.conf, 'letterhead');
    }
    const band = blockAt(idx, cell);
    const street = band.filter(c => /^\s*\d/.test(c.text));
    const names = band.filter(c => !street.includes(c));
    if (street.length && !party.address1.v) party.address1 = F(trim(street[0].text), cell.conf, 'letterhead');
    if (names.length && !party.name.v)
      party.name = F(trim(names[names.length - 1].text).slice(0, 60), cell.conf * 0.9, 'letterhead');
  };
  for (const [idx, cell] of anchors) {
    if (carrierHdr !== null && idx > carrierHdr) fill(t.carrier, idx, cell);
    else fill(t.shipper, idx, cell);
  }
  for (const party of [t.carrier, t.shipper])
    if (party.name.v && (String(party.name.v).length > 60 || /\bterms\b|\bagree/i.test(String(party.name.v))))
      party.name = F(null, 0, '');
}

/* ---------------------------------------------------------- postprocess */
function resolveStopTypes(t: LoadTender): void {
  const unknown = t.stops.filter(s => s.stop_type.v === 'unknown');
  if (!unknown.length) return;
  const knownPu = t.stops.filter(s => s.stop_type.v === 'pickup');
  t.stops.forEach((s, i) => {
    if (s.stop_type.v !== 'unknown') return;
    s.stop_type = (i === 0 && !knownPu.length)
      ? F('pickup', 0.5, 'derived', 'first stop assumed pickup')
      : F('delivery', 0.5, 'derived', 'assumed delivery');
  });
  t.warnings.push(`${unknown.length} stop(s) had no pickup/delivery wording; ` +
    `inferred from stop order. Confirm before transmitting.`);
}

export function postprocess(t: LoadTender): LoadTender {
  resolveStopTypes(t);
  const pickups = t.stops.filter(s => String(s.stop_type.v).startsWith('pick'));
  const drops = t.stops.filter(s => !String(s.stop_type.v).startsWith('pick'));
  pickups.forEach((s, i) => {
    const last = i === pickups.length - 1;
    s.reason_code = F(last ? 'CL' : 'PL', 0.9, 'derived', last ? 'complete load' : 'partial load');
  });
  drops.forEach((s, i) => {
    const last = i === drops.length - 1;
    s.reason_code = F(last ? 'CU' : 'PU', 0.9, 'derived', last ? 'complete unload' : 'partial unload');
  });
  t.stops.forEach((s, i) => { s.sequence = F(i + 1, 1, 'derived'); });

  if (t.total_weight.v)
    for (const s of t.stops)
      if (!s.weight.v && String(s.stop_type.v).startsWith('pick')) {
        s.weight = F(t.total_weight.v, 0.6, 'derived', 'header weight');
        s.weight_uom = F(t.weight_uom.v || 'L', 0.6, 'derived');
      }

  if (!t.stops.length)
    t.warnings.push('No stops detected - a 204 cannot be built without at least one pickup and one delivery.');
  else if (!pickups.length) t.warnings.push('No pickup stop detected.');
  else if (!drops.length) t.warnings.push('No delivery stop detected.');

  if (!t.shipment_id.v) t.warnings.push('No shipment/load number found - required for B2-04.');
  if (!t.equipment.type_code.v) t.warnings.push('Equipment type could not be mapped to an X12 code (N7-11).');

  if (t.charges.length && t.total_charge.v) {
    const s = t.charges.reduce((a, c) => a + ((c.amount.v as number) || 0), 0);
    if (s && Math.abs(s - (t.total_charge.v as number)) > 0.02)
      t.warnings.push(`Rate breakdown sums to ${s.toFixed(2)} but stated total is ${(t.total_charge.v as number).toFixed(2)}.`);
  }
  return t;
}

/* --------------------------------------------------- confidence report */
export function confidenceReport(t: LoadTender): EngineConfidenceReport {
  const out: ConfidenceField[] = [];
  const walk = (obj: any, path: string) => {
    if (obj && typeof obj === 'object' && 'v' in obj && 'c' in obj) {
      if (obj.v !== null && obj.v !== '' && obj.v !== undefined)
        out.push({ path, value: obj.v, confidence: Math.round(obj.c * 100) / 100, source: obj.s || '-' });
      return;
    }
    if (Array.isArray(obj)) { obj.forEach((x, i) => walk(x, `${path}[${i}]`)); return; }
    if (obj && typeof obj === 'object')
      for (const k of Object.keys(obj)) {
        if (['source_file','source_kind','extracted_at','warnings','pages','id'].includes(k)) continue;
        walk(obj[k], path ? `${path}.${k}` : k);
      }
  };
  walk(t, '');
  const score = out.length ? out.reduce((a, f) => a + f.confidence, 0) / out.length : 0;
  return { fields: out, needsReview: out.filter(f => f.confidence < 0.75),
           score: Math.round(score * 1000) / 1000 };
}
