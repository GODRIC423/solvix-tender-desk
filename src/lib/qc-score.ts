/**
 * The QC score shown on the board and the load screen.
 *
 * The engine's own `confidenceReport()` averages confidence across whatever
 * fields happened to get populated. That is the right measure of "how sure are
 * we about what we read", but it is the wrong measure of "did we understand
 * this document" — and the board uses it as the latter.
 *
 * The failure is not hypothetical. A tender the parser got nothing out of —
 * no stops, no shipment id, no dates, no weight, no rate — still scored 78%,
 * because four of the eight fields it "populated" are constants the engine
 * emits for every document regardless of content (purpose 00, method of
 * payment PP, weight UOM L, currency USD) and the rest were two reference
 * numbers. On the board that renders yellow: "glance at it". The whole point
 * of red is to say what is missing, so a load where everything is missing has
 * to be red.
 *
 * So the score is coverage-weighted instead: we ask what a load tender must
 * contain, and a missing answer scores zero rather than being left out of the
 * average. The worse the extraction, the lower the number — which is the only
 * behaviour a dispatcher can safely act on.
 */

import type { Field, LoadTender, Stop } from '@/types/tender'

/** Confidence of a field, or null when it holds no value. */
function conf(f: Field | null | undefined): number | null {
  if (!f) return null
  if (f.v === null || f.v === undefined || f.v === '') return null
  return typeof f.c === 'number' ? f.c : null
}

/** First field that actually holds a value. */
function firstOf(...fields: Array<Field | null | undefined>): number | null {
  for (const f of fields) {
    const c = conf(f)
    if (c !== null) return c
  }
  return null
}

function stopsOfType(t: LoadTender, type: 'pickup' | 'delivery'): Stop[] {
  return (t.stops ?? []).filter((s) => String(s?.stop_type?.v ?? '').toLowerCase() === type)
}

/** A stop counts as located only if we know the town it is in. */
function stopLocated(s: Stop | undefined): number | null {
  if (!s) return null
  const city = conf(s.party?.city)
  const state = conf(s.party?.state)
  if (city === null || state === null) return null
  return (city + state) / 2
}

/** A stop counts as scheduled if it has any time to work against. */
function stopScheduled(s: Stop | undefined): number | null {
  if (!s) return null
  return firstOf(s.appointment, s.earliest, s.latest)
}

export interface QcExpectation {
  key: string
  label: string
  /** Confidence 0..1 when the tender answers this, or null when it does not. */
  score: number | null
}

/**
 * What a load tender has to tell us. Deliberately excludes the derived
 * constants — they are the same on every document, so they carry no evidence
 * about this one and must not prop the score up.
 */
export function qcExpectations(t: LoadTender | null | undefined): QcExpectation[] {
  if (!t) return []
  const pickup = stopsOfType(t, 'pickup')[0]
  const delivery = stopsOfType(t, 'delivery')[0]

  return [
    { key: 'shipment_id', label: 'Shipment / order number', score: conf(t.shipment_id) },
    { key: 'tender_date', label: 'Tender date', score: conf(t.tender_date) },
    {
      key: 'equipment',
      label: 'Equipment',
      score: firstOf(t.equipment?.type_code, t.equipment?.type_text),
    },
    { key: 'weight', label: 'Weight', score: conf(t.total_weight) },
    { key: 'commodity', label: 'Commodity', score: conf(t.commodity) },
    { key: 'rate', label: 'Rate', score: conf(t.total_charge) },
    { key: 'pickup_location', label: 'Pickup location', score: stopLocated(pickup) },
    { key: 'pickup_window', label: 'Pickup window', score: stopScheduled(pickup) },
    { key: 'delivery_location', label: 'Delivery location', score: stopLocated(delivery) },
    { key: 'delivery_window', label: 'Delivery window', score: stopScheduled(delivery) },
  ]
}

/**
 * 0..1, rounded to 3dp. A missing expectation contributes zero, so coverage
 * and confidence both move the number.
 */
export function qcScore(t: LoadTender | null | undefined): number {
  const expectations = qcExpectations(t)
  if (!expectations.length) return 0
  const total = expectations.reduce((sum, e) => sum + (e.score ?? 0), 0)
  return Math.round((total / expectations.length) * 1000) / 1000
}

/** The expectations the tender did not answer — the "what's missing" list. */
export function qcMissing(t: LoadTender | null | undefined): QcExpectation[] {
  return qcExpectations(t).filter((e) => e.score === null)
}
