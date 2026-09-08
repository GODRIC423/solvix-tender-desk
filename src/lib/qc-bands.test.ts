import { describe, expect, it } from 'vitest'
import { bandFor, DEFAULT_QC_BANDS, formatConfidence } from './qc-bands'
import { meanConfidence, fieldAt } from './load-fields'
import type { LoadTender } from '@/types/tender'

describe('QC confidence banding', () => {
  it('bands the four tiers as specified', () => {
    expect(bandFor(0.95)).toBe('green') // >= 90
    expect(bandFor(0.82)).toBe('yellow') // 75-89
    expect(bandFor(0.61)).toBe('orange') // 50-74
    expect(bandFor(0.3)).toBe('red') // <= 49
  })

  it('puts each boundary in the higher band', () => {
    expect(bandFor(0.9)).toBe('green')
    expect(bandFor(0.75)).toBe('yellow')
    expect(bandFor(0.5)).toBe('orange')
    expect(bandFor(0.4999)).toBe('red')
  })

  it('distinguishes "never found" from "found but wrong"', () => {
    // A field the parser never populated is not the same problem as one it
    // read badly, and the QC screen colours them differently.
    expect(bandFor(null)).toBe('none')
    expect(bandFor(undefined)).toBe('none')
    expect(bandFor(0)).toBe('red')
  })

  it('honours configured thresholds', () => {
    const strict = { green: 0.99, yellow: 0.9, orange: 0.8 }
    expect(bandFor(0.95, strict)).toBe('yellow')
    expect(bandFor(0.95, DEFAULT_QC_BANDS)).toBe('green')
  })

  it('formats confidence for display', () => {
    expect(formatConfidence(0.917)).toBe('92%')
    expect(formatConfidence(null)).toBe('—')
  })
})

const F = (v: unknown, c: number) => ({ v, c, s: 'parsed', raw: '' })

describe('overall load score', () => {
  it('averages only the fields that actually got a value', () => {
    // An empty field must not drag the score down — "we didn't find it" is
    // reported by the warnings, not by pretending it scored zero.
    const tender = {
      shipment_id: F('LT-1', 1),
      commodity: F('Paper', 0.5),
      notes: F(null, 0),
      terms: F('', 0),
    } as unknown as LoadTender

    expect(meanConfidence(tender)).toBe(0.75)
  })

  it('walks nested objects and arrays', () => {
    const tender = {
      shipment_id: F('LT-1', 1),
      equipment: { type_code: F('TV', 0.6) },
      stops: [{ party: { city: F('Atlanta', 0.8) } }],
    } as unknown as LoadTender

    expect(meanConfidence(tender)).toBeCloseTo(0.8, 5)
  })

  it('is null when there is nothing to score', () => {
    expect(meanConfidence({} as LoadTender)).toBeNull()
    expect(meanConfidence(null)).toBeNull()
  })
})

describe('reading a field out of the raw extraction', () => {
  const tender = {
    shipment_id: F('LT-9', 0.99),
    equipment: { type_code: F('TV', 0.61) },
  } as unknown as LoadTender

  it('resolves a dotted path', () => {
    expect(fieldAt(tender, 'equipment.type_code')?.v).toBe('TV')
    expect(fieldAt(tender, 'shipment_id')?.c).toBe(0.99)
  })

  it('returns null rather than throwing on a missing path', () => {
    expect(fieldAt(tender, 'equipment.nope')).toBeNull()
    expect(fieldAt(tender, 'a.b.c.d')).toBeNull()
    expect(fieldAt(null, 'shipment_id')).toBeNull()
    expect(fieldAt(tender, undefined)).toBeNull()
  })
})
