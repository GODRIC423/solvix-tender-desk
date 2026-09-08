/**
 * Field parsers — labels, geometry and value shapes.
 *
 * Lifted verbatim from legacy/index.html L295-690 (the `P` IIFE). Every regex,
 * threshold, OCR digit-correction and scoring rule below is tuned against real
 * scanned tenders; treat this file as data, not as code to be tidied. Diff
 * against the legacy file before changing anything.
 *
 * Nothing here is keyed to a specific customer's template, which is why a
 * shipper you have never seen parses on day one.
 */

import type { Field, TenderCharge, TenderReference } from '@/types/tender';

const MONTHS: Record<string, number> = {};
['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
  .forEach((m, i) => MONTHS[m] = i + 1);
['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
  'september', 'october', 'november', 'december'].forEach((m, i) => MONTHS[m] = i + 1);

export const CITY_STATE_ZIP = new RegExp(
  "^(?<city>[A-Za-z][A-Za-z .'\\-]{1,40}?)[,\\s]+" +
  "(?<state>A[LKZR]|C[AOT]|D[EC]|FL|GA|HI|I[DLNA]|K[SY]|LA|M[EDAINSOT]|" +
  "N[EVHJMYCD]|O[HKR]|P[AR]|RI|S[CD]|T[NX]|UT|V[TA]|W[AVIY]|" +
  "AB|BC|MB|NB|NL|NS|NT|NU|ON|PE|QC|SK|YT)" +
  "[,\\s]+(?<zip>\\d{5}(?:-\\d{4})?|[A-Z]\\d[A-Z] ?\\d[A-Z]\\d)\\b", "i");

/* Tesseract regularly reads the slashes in a date as 7 or 1. */
export function fixOcrDigits(s: any): any {
  let m = /^(\d{2})[7\/1](\d{2})[7\/1](\d{4})$/.exec(s);
  if (m) return `${m[1]}/${m[2]}/${m[3]}`;
  m = /^(\d{2})(\d{2})7(\d{4})$/.exec(s);
  if (m) return `${m[1]}/${m[2]}/${m[3]}`;
  // a dropped or mis-read second separator: 03/1620 or 03/17:20
  m = /^(\d{1,2})\/(\d{2})[:;.,]?(\d{2,4})$/.exec(s);
  if (m) return `${m[1]}/${m[2]}/${m[3]}`;
  return s;
}

const DATE_PATTERNS: Array<[RegExp, string]> = [
  [/\b(\d{4})-(\d{2})-(\d{2})\b/, 'ymd'],
  [/\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})\b/, 'mdy'],
  [/\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/, 'mony'],
  [/\b(\d{1,2})\s+([A-Za-z]{3,9})\.?\s+(\d{4})\b/, 'dmony'],
  [/\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/, 'monNoYear'],
];

function mkDate(y: number, m: number, d: number): any {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return { y, m, d };
}

export function parseDate(text: any, defaultYear?: any): any {
  if (!text) return null;
  const t = String(text).split(/\s+/).map(fixOcrDigits).join(' ');
  for (const [rx, kind] of DATE_PATTERNS) {
    const m = rx.exec(t);
    if (!m) continue;
    if (kind === 'ymd') return mkDate(+m[1], +m[2], +m[3]);
    if (kind === 'mdy') {
      let [, a, b, c] = m; let mo = +a, d = +b, y = +c;
      if (y < 100) y += y < 70 ? 2000 : 1900;
      if (mo > 12 && d <= 12) { const t2 = mo; mo = d; d = t2; }
      const r = mkDate(y, mo, d); if (r) return r;
    }
    if (kind === 'mony') {
      const mo = MONTHS[m[1].toLowerCase()];
      if (mo) { const r = mkDate(+m[3], mo, +m[2]); if (r) return r; }
    }
    if (kind === 'dmony') {
      const mo = MONTHS[m[2].toLowerCase()];
      if (mo) { const r = mkDate(+m[3], mo, +m[1]); if (r) return r; }
    }
    if (kind === 'monNoYear' && defaultYear) {
      const mo = MONTHS[m[1].toLowerCase()];
      if (mo) { const r = mkDate(defaultYear, mo, +m[2]); if (r) return r; }
    }
  }
  return null;
}

const TIME_RE = /\b(\d{1,2})[:.](\d{2})\s*(AM|PM|am|pm)?\b|\b(\d{1,2})\s*(AM|PM|am|pm)\b/g;
const TZ_RE = /\b(EST|EDT|CST|CDT|MST|MDT|PST|PDT|AKST|HST|UTC|GMT)\b/;

export function parseTimes(text: any): Array<[number, number]> {
  if (!text) return [];
  const out: Array<[number, number]> = [];
  TIME_RE.lastIndex = 0;
  let m;
  while ((m = TIME_RE.exec(text)) !== null) {
    let h, mi, ap;
    if (m[1] !== undefined) { h = +m[1]; mi = +m[2]; ap = m[3]; }
    else { h = +m[4]; mi = 0; ap = m[5]; }
    if (ap) {
      ap = ap.toUpperCase();
      if (ap === 'PM' && h !== 12) h += 12;
      if (ap === 'AM' && h === 12) h = 0;
    }
    if (h >= 0 && h <= 23 && mi >= 0 && mi <= 59) out.push([h, mi]);
  }
  return out;
}

const pad = (n: any, w = 2) => String(n).padStart(w, '0');
export const iso = (d: any, t?: any) =>
  `${d.y}-${pad(d.m)}-${pad(d.d)}T${pad(t ? t[0] : 0)}:${pad(t ? t[1] : 0)}`;

export function parseWindow(text: any, defaultYear?: any): [any, any, any] {
  if (!text) return [null, null, null];
  const d = parseDate(text, defaultYear);
  const times = parseTimes(text);
  const tzm = TZ_RE.exec(text);
  const tz = tzm ? tzm[1] : null;
  if (!d) return [null, null, tz];
  if (!times.length) return [iso(d, null), null, tz];
  if (times.length === 1) return [iso(d, times[0]), null, tz];
  return [iso(d, times[0]), iso(d, times[1]), tz];
}

const MONEY_RE = /\$?\s*(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+\.\d{2}|\d+)\b/;
export function parseMoney(text: any): number | null {
  if (!text) return null;
  const m = MONEY_RE.exec(String(text).replace(/ /g, ''));
  if (!m) return null;
  const v = parseFloat(m[1].replace(/,/g, ''));
  return Number.isFinite(v) ? v : null;
}

const WEIGHT_RE = /(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(lbs?\.?|pounds?|kgs?\.?|kilograms?)?/i;
export function parseWeight(text: any): [any, any] {
  if (!text) return [null, null];
  const m = WEIGHT_RE.exec(text);
  if (!m) return [null, null];
  const v = parseFloat(m[1].replace(/,/g, ''));
  if (!Number.isFinite(v)) return [null, null];
  return [v, m[2] && /^k/i.test(m[2]) ? 'K' : 'L'];
}

export const PHONE_RE = /(?:\+?1[\s.\-]?)?\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4}/;
export const EMAIL_RE = /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/;
export const normPhone = (t: any) => {
  let d = String(t).replace(/\D/g, '');
  if (d.length === 11 && d[0] === '1') d = d.slice(1);
  return d.slice(0, 10);
};

/* ---------------------------------------------------------------- labels */
export const LABELS: Record<string, string[]> = {
  shipment_id: ['load #', 'load#', 'load no', 'load number', 'load id', 'tender id',
    'tender #', 'tender no', 'order #', 'order no', 'order number', 'shipment id',
    'shipment #', 'trip #', 'trip no', 'pro #', 'pro no', 'confirmation #',
    'booking #', 'load confirmation #', 'reference id'],
  tender_date: ['tender date', 'order date', 'date created', 'created',
    'confirmation date', 'date'],
  equipment_text: ['required equipment', 'equipment type', 'equipment',
    'trailer type', 'equip type', 'equip'],
  equipment_length: ['equipment length', 'trailer length', 'length'],
  total_weight: ['total weight', 'gross weight', 'weight'],
  commodity: ['commodity', 'product', 'goods', 'freight description',
    'description of goods'],
  distance_miles: ['total distance', 'distance', 'total miles', 'loaded miles', 'miles'],
  mc_number: ['mc number', 'mc #', 'mc#', 'mc no', 'motor carrier #'],
  scac: ['scac', 'scac code'],
  carrier_name: ['carrier', 'carrier name'],
  shipper_name: ['shipper/logistics', 'shipper', 'customer', 'broker', 'logistics',
    'bill to', 'billing'],
  notes: ['special instructions', 'instructions', 'notes', 'comments', 'remarks', 'note'],
  total_charge: ['total agreed carrier payout', 'total carrier pay', 'carrier pay',
    'total rate', 'total charge', 'total charges', 'agreed rate', 'total amount',
    'total pay', 'total'],
  driver_name: ['driver name', 'driver'],
  driver_phone: ['driver cell phone #', 'driver cell', 'driver phone'],
  references: ['reference(s)', 'references', 'reference', 'ref #', 'refs'],
};

export const HEADING_WORDS = new Set(['information', 'info', 'details', 'detail', 'summary',
  'breakdown', 'and references', 'references', 'terms', 'items', 'schedule', 'routing',
  'actions', 'instructions']);

/* label -> X12 L11 reference qualifier (element 128) */
export const REF_QUALIFIERS: Record<string, string> = {
  'po': 'PO', 'purchase order': 'PO', 'p.o.': 'PO', 'po #': 'PO',
  'bol': 'BM', 'bill of lading': 'BM', 'b/l': 'BM',
  'pro': 'CN', 'pro #': 'CN', 'pro number': 'CN',
  'pickup #': 'P8', 'pickup number': 'P8', 'pu #': 'P8', 'pickup': 'P8', 'pu': 'P8',
  'delivery #': 'KK', 'del #': 'KK', 'delivery': 'KK', 'del': 'KK',
  'appointment': 'AO', 'appt': 'AO', 'appointment #': 'AO',
  'seal': 'SN', 'seal #': 'SN', 'seal number': 'SN',
  'order': 'OQ', 'order #': 'OQ', 'customer order': 'CO',
  'load': 'SI', 'load #': 'SI', 'shipper ref': 'SI', 'trailer': 'EQ',
  'release': 'RE', 'confirmation': 'CR', 'ref': 'ZZ',
};

const EQUIPMENT_CODES: Array<[RegExp, string, string]> = [
  [/reefer|refrigerat|temp[- ]?control|frozen|chilled/i, 'RT', 'Refrigerated trailer'],
  [/flat ?bed|\bflat\b|step ?deck|conestoga|rgn|lowboy/i, 'FT', 'Flatbed'],
  [/container|intermodal|\bcntr\b/i, 'CN', 'Container'],
  [/\btank(er)?\b/i, 'TK', 'Tanker'],
  [/dry ?van|\bvan\b|\bdv\b/i, 'TV', 'Dry van'],
  [/straight|box ?truck/i, 'SV', 'Straight truck'],
  [/power ?only/i, 'TV', 'Power only (van assumed)'],
];

export function equipmentCode(text: any): [any, any] {
  const t = String(text || '');
  for (const [rx, code, desc] of EQUIPMENT_CODES) if (rx.test(t)) return [code, desc];
  return [null, null];
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function startsWithOtherLabel(tail: string, ownKey: string): boolean {
  const t = tail.toLowerCase();
  for (const group of Object.values(LABELS))
    for (const k of group) {
      if (k === ownKey) continue;
      if (t.startsWith(k + ' ') || t === k) return true;
    }
  return false;
}

/* Scored label lookup. Tenders are full of near-misses: the heading
   "EQUIPMENT & LOAD DETAILS" must not beat "Required Equipment: 53' Dry Van",
   and "Total Agreed Carrier Payout:" must not answer a lookup for "Carrier".
     3  label followed by an explicit ':' or '-'    (strongest)
     2  the cell IS the label; value is next cell
     1  label at the start of the cell
     0  label buried mid-cell (OCR noise, run-on lines) */
export function findLabeled(
  cellsByLine: any[],
  keys: string[],
  maxGapLines = 1,
  validator: ((v: any) => boolean) | null = null,
): [any, number, string] {
  const uniq = [...new Set(keys.map(k => k.toLowerCase()))]
    .sort((a, b) => b.length - a.length);
  const cands: any[] = [];
  for (let li = 0; li < cellsByLine.length; li++) {
    const cells = cellsByLine[li];
    for (let ci = 0; ci < cells.length; ci++) {
      const cell = cells[ci], text = cell.text, low = text.toLowerCase();
      for (const k of uniq) {
        const rx = new RegExp('(?<![A-Za-z0-9])' + esc(k) + '(?![A-Za-z])');
        const m = rx.exec(low);
        if (!m) continue;
        const end = m.index + k.length;
        const after = text.slice(end);
        const sep = /^\s*[:\-]\s*/.exec(after);
        const norm = (s: string) => s.replace(/[\s:.\-#()]+/g, '');
        const bare = norm(low) === norm(k);
        let cand = null;
        if (sep && after.slice(sep[0].length).trim()) {
          cand = [3, k.length, -li, after.slice(sep[0].length).trim(), cell.conf, text];
        } else if (bare) {
          let val = null, conf = cell.conf;
          if (ci + 1 < cells.length) {
            val = cells[ci + 1].text.trim();
            conf = Math.min(conf, cells[ci + 1].conf);
          } else {
            for (let j = 1; j <= maxGapLines; j++) {
              const nxt = cellsByLine[li + j];
              if (nxt && nxt.length) { val = nxt[0].text.trim(); conf = Math.min(conf, nxt[0].conf); break; }
            }
          }
          if (val) cand = [2, k.length, -li, val, conf, text];
        } else if (after.trim()) {
          const tail = after.trim();
          if (startsWithOtherLabel(tail, k)) continue;
          if (/^[A-Za-z][A-Za-z &/]{0,18}:/.test(tail)) continue;
          if (HEADING_WORDS.has(tail.trim().toLowerCase().replace(/:$/, ''))) continue;
          cand = [m.index === 0 ? 1 : 0, k.length, -li, tail, cell.conf, text];
        }
        if (cand) { cands.push(cand); break; }
      }
    }
  }
  cands.sort((a, b) => b[0] - a[0] || b[1] - a[1] || b[2] - a[2]);
  for (const c of cands) if (!validator || validator(c[3])) return [c[3], c[4], c[5]];
  return [null, 0, ''];
}

/* -------------------------------------------------------- stop detection */
const STOP_KW = "pick\\s*-?up|pickup|delivery|deliver|origin|destination|" +
                "consignee|shipper|drop|load|unload|final|stop";
export const STOP_START = new RegExp(
  "^\\s*(?:stop\\s*#?\\s*)?\\d{1,2}\\s*[.)\\-]?\\s*$" +
  "|^\\s*(?:stop\\s*#?\\s*)?\\d{1,2}\\s*[.)\\-]?\\s+(?:" + STOP_KW + ")\\b" +
  "|^\\s*(?:" + STOP_KW + ")\\b", "i");

export const STOP_SECTION_START = /stops?\s*(\/|&|and)?\s*(actions?|schedule|routing|details|type)?\s*$|multi[- ]?stop|schedule\s*&?\s*routing|pick\s*-?up\s*(&|and|\/)\s*deliver|itinerary|route\s+details|stop\s*\/\s*type/i;
export const STOP_SECTION_END = /pay\s*items?|financial|rate\s+breakdown|charges?\s*$|carrier\s+terms|terms\s+(and|&)\s+conditions|signature|billing|remit/i;
export const TABLE_HEADER_WORDS = ['location', 'address', 'date', 'time', 'appointment',
  'window', 'contact', 'action', 'instructions', 'details', 'type', 'stop'];

export const PICKUP_WORDS = /pick\s*-?up|\borigin\b|\bshipper\b|(?<![a-z])load(?!ing)|\bcollect\b|\bpu\b/i;
export const DELIVER_WORDS = /\bdeliver\w*|\bdestination\b|\bconsignee\b|\bunload\w*|\bdrop\b|\breceiver\b|\bfinal\b|\bdel\b/i;

export function stopSectionBounds(lines: any[]): [any, any] {
  let start = null;
  for (let i = 0; i < lines.length; i++) {
    const txt = (lines[i].text || '').trim();
    if (!txt || txt.length > 90) continue;
    if (STOP_SECTION_START.test(txt)) { start = i; continue; }
    const low = txt.toLowerCase();
    const hits = TABLE_HEADER_WORDS.filter(w => low.includes(w)).length;
    if (hits >= 3 && lines[i].cells.length >= 2 && !CITY_STATE_ZIP.test(txt)) {
      start = i; break;
    }
  }
  if (start === null) return [null, null];
  let end = lines.length;
  for (let j = start + 1; j < lines.length; j++) {
    const txt = (lines[j].text || '').trim();
    if (txt && txt.length < 70 && STOP_SECTION_END.test(txt) && !CITY_STATE_ZIP.test(txt)) {
      end = j; break;
    }
  }
  return [start, end];
}

export const isTimeish = (t: any) => {
  const stripped = String(t).replace(/[\d:\-\s.apmAPM]|EST|EDT|CST|CDT|MST|MDT|PST|PDT|UTC/g, '');
  return parseTimes(t).length > 0 && stripped.length <= 2;
};

export const cleanLine = (t: any) => String(t)
  .replace(/\s*(primary\s+contact|contact)\s*:?\s*$/i, '')
  .replace(/\s*phone\s*:?.*$/i, '')
  .replace(/^[\s|,;]+|[\s|,;]+$/g, '');

export function F(v?: any, c = 0, s = '', raw = ''): Field {
  return { v: v === undefined ? null : v, c, s: s as Field['s'], raw };
}

export function harvestReferences(text: any): TenderReference[] {
  const out: TenderReference[] = [], seen = new Set();
  if (!text) return out;
  const pat = /\b(PO|P\.O\.|BOL|B\/L|PRO|SEAL|APPT|APPOINTMENT|PICKUP|PU|DELIVERY|DEL|ORDER|REF|RELEASE|TRAILER)\b\s*(?:#|no\.?|number)?\s*[:\-]?\s*(?=[A-Z0-9\-]*\d)([A-Z0-9][A-Z0-9\-]{3,20})\b/gi;
  let m;
  while ((m = pat.exec(text)) !== null) {
    const label = m[1].toLowerCase().replace(/\.$/, '');
    const val = m[2].toUpperCase().replace(/^-+|-+$/g, '');
    const qual = REF_QUALIFIERS[label] || REF_QUALIFIERS[label + ' #'] || 'ZZ';
    const key = qual + '|' + val;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ label: m[1], qualifier: F(qual, 0.85, 'parsed'), value: F(val, 0.9, 'parsed', m[0]) });
  }
  // OCR swaps O and 0 constantly: "PO6948654" comes back as "P06948654"
  const bare = /\b(P[O0]|B[O0]L|PR[O0])[O0]?(\d{5,12})\b/gi;
  while ((m = bare.exec(text)) !== null) {
    const norm = m[1].toUpperCase().replace(/0/g, 'O');
    const qual = REF_QUALIFIERS[norm.toLowerCase()] || 'ZZ';
    const key = qual + '|' + m[2];
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ label: norm, qualifier: F(qual, 0.9, 'parsed'), value: F(m[2], 0.92, 'parsed', m[0]) });
  }
  return out;
}

const CHARGE_LABEL = /(linehaul|line haul|base rate|fuel|fsc|surcharge|stop[- ]?off|stop off|detention|lumper|layover|tarp|accessorial|flat rate|rate|unloading|loading|toll|permit)/i;
const ACCESSORIAL_CODES: Record<string, string> = {
  'linehaul': '400', 'line haul': '400', 'base rate': '400', 'flat rate': '400',
  'fuel': '405', 'fsc': '405', 'surcharge': '405',
  'stop-off': '191', 'stop off': '191', 'stopoff': '191',
  'detention': 'DET', 'lumper': 'LUM', 'layover': 'LAY', 'tarp': 'TRP',
};

export function extractCharges(lines: any[]): [TenderCharge[], any] {
  const charges: any[] = [];
  let total = null;
  for (const ln of lines) {
    const txt = ln.text || '', low = txt.toLowerCase();
    let amt = null;
    for (let i = ln.cells.length - 1; i >= 0; i--) {
      const a = parseMoney(ln.cells[i].text);
      if (a !== null && /\d/.test(ln.cells[i].text)) { amt = a; break; }
    }
    if (amt === null) continue;
    if (/\btotal\b/.test(low) && !/total (weight|distance|miles)/.test(low)) {
      total = [amt, Math.min(...ln.cells.map((c: any) => c.conf), 0.9), txt];
      continue;
    }
    const m = CHARGE_LABEL.exec(low);
    if (!m) continue;
    const desc = txt.replace(/\$?\s*[\d,]+\.?\d*\s*$/, '').replace(/[\s:.\-]+$/, '');
    charges.push({
      description: F(desc.slice(0, 60), 0.85, 'parsed', txt),
      code: F(ACCESSORIAL_CODES[m[1].toLowerCase()] || 'ZZZ', 0.7, 'derived', m[1]),
      quantity: F(null), rate: F(null),
      amount: F(amt, 0.9, 'parsed', txt),
    });
  }
  if (total === null && charges.length)
    total = [charges.reduce((a, c) => a + (c.amount.v || 0), 0), 0.6, 'summed'];
  return [charges, total];
}
