import { describe, expect, it } from 'vitest'
import { qcScore, qcMissing, qcExpectations } from './qc-score'
import type { LoadTender } from '@/types/tender'

const F = (v: unknown, c: number) => ({ v, c, s: 'parsed', raw: '' })
const empty = () => ({ v: null, c: 0, s: '', raw: '' })

function stop(type: string, opts: { located?: boolean; scheduled?: boolean } = {}) {
  return {
    stop_type: F(type, 0.9),
    party: {
      city: opts.located ? F('Atlanta', 0.95) : empty(),
      state: opts.located ? F('GA', 0.95) : empty(),
    },
    appointment: opts.scheduled ? F('2026-08-20T08:00', 0.9) : empty(),
    earliest: empty(),
    latest: empty(),
  }
}

/** The real failure this scorer exists to prevent. */
const nothingExtracted = {
  // These four are emitted for every document regardless of content.
  purpose: F('00', 1),
  method_of_payment: F('PP', 0.5),
  weight_uom: F('L', 0.6),
  currency: F('USD', 0.6),
  // Two reference numbers were all the parser actually found.
  references: [{ qualifier: F('PO', 0.85), value: F('4472281', 0.9) }],
  shipment_id: empty(),
  tender_date: empty(),
  equipment: { type_code: empty(), type_text: empty() },
  total_weight: empty(),
  commodity: empty(),
  total_charge: empty(),
  stops: [],
} as unknown as LoadTender

const fullyExtracted = {
  shipment_id: F('LT-2026-89412', 0.99),
  tender_date: F('2026-08-19', 0.99),
  equipment: { type_code: F('TV', 0.94), type_text: F('Dry Van', 0.9) },
  total_weight: F(38500, 0.9),
  commodity: F('Canned Goods', 0.9),
  total_charge: F(3450, 0.95),
  stops: [
    stop('pickup', { located: true, scheduled: true }),
    stop('delivery', { located: true, scheduled: true }),
  ],
} as unknown as LoadTender

describe('QC score reflects coverage, not just confidence', () => {
  it('scores a document it understood nothing from as red', () => {
    // The engine's own mean-of-populated-fields gave this 78% — yellow, "check
    // it" — because the constants and two reference numbers were all it saw.
    const score = qcScore(nothingExtracted)
    expect(score).toBe(0)
    expect(score).toBeLessThan(0.5) // red band
  })

  it('scores a well-read tender green', () => {
    expect(qcScore(fullyExtracted)).toBeGreaterThanOrEqual(0.9)
  })

  it('degrades as coverage drops rather than staying flat', () => {
    const halfRead = {
      ...fullyExtracted,
      total_weight: empty(),
      commodity: empty(),
      total_charge: empty(),
      stops: [stop('pickup', { located: true, scheduled: true })],
    } as unknown as LoadTender

    const full = qcScore(fullyExtracted)
    const half = qcScore(halfRead)
    expect(half).toBeLessThan(full)
    expect(half).toBeGreaterThan(0)
  })

  it('never lets the always-present constants prop up the score', () => {
    // purpose / method_of_payment / weight_uom / currency must not appear.
    const keys = qcExpectations(nothingExtracted).map((e) => e.key)
    expect(keys).not.toContain('purpose')
    expect(keys).not.toContain('method_of_payment')
    expect(keys).not.toContain('weight_uom')
    expect(keys).not.toContain('currency')
  })

  it('names what is missing, which is what red is for', () => {
    const missing = qcMissing(nothingExtracted).map((e) => e.key)
    expect(missing).toContain('shipment_id')
    expect(missing).toContain('pickup_location')
    expect(missing).toContain('delivery_window')
    expect(qcMissing(fullyExtracted)).toHaveLength(0)
  })

  it('counts a stop as located only when the town is known', () => {
    const noCity = {
      ...fullyExtracted,
      stops: [stop('pickup', { located: false, scheduled: true }), stop('delivery', { located: true, scheduled: true })],
    } as unknown as LoadTender
    expect(qcMissing(noCity).map((e) => e.key)).toContain('pickup_location')
  })

  it('handles a null or empty tender without throwing', () => {
    expect(qcScore(null)).toBe(0)
    expect(qcScore({} as LoadTender)).toBe(0)
  })
})
