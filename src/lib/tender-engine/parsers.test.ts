/**
 * Regression tests for the tender parsers.
 *
 * This code came out of the original single-file app, where it had no tests at
 * all. It is the highest-risk code in the repo: a silent parser regression
 * means a load is created with the wrong pickup date and nobody notices until
 * a truck misses an appointment. These pin the behaviour that was verified
 * byte-for-byte against the legacy implementation during the port.
 *
 * Inputs here are the shapes that actually show up on freight paperwork,
 * including the OCR damage the parsers exist to survive.
 */

import { describe, expect, it } from 'vitest'
import {
  equipmentCode,
  fixOcrDigits,
  harvestReferences,
  normPhone,
  parseDate,
  parseMoney,
  parseWeight,
} from './parsers'

describe('parseDate', () => {
  // Returns a {y, m, d} record, not a string — `iso()` renders it.
  const AUG_20 = { y: 2026, m: 8, d: 20 }

  it('reads the formats tenders actually use', () => {
    expect(parseDate('2026-08-20')).toEqual(AUG_20)
    expect(parseDate('08/20/2026')).toEqual(AUG_20)
    expect(parseDate('Aug 20, 2026')).toEqual(AUG_20)
    expect(parseDate('20 Aug 2026')).toEqual(AUG_20)
  })

  it('expands a two-digit year on the near side of the century', () => {
    expect(parseDate('08/20/26')).toEqual(AUG_20)
  })

  it('swaps an impossible month/day pair rather than giving up', () => {
    // 20/08 can only be day/month, so the parser flips it.
    expect(parseDate('20/08/2026')).toEqual(AUG_20)
  })

  it('rejects a date that does not exist rather than rolling it over', () => {
    // Feb 30 must be null, not March 2 — a silently rolled-over appointment
    // date is worse than an obviously missing one.
    expect(parseDate('02/30/2026')).toBeNull()
  })

  it('returns null on junk instead of a wrong date', () => {
    expect(parseDate('')).toBeNull()
    expect(parseDate(null)).toBeNull()
    expect(parseDate('not a date at all')).toBeNull()
  })
})

describe('parseMoney', () => {
  it('reads rates off a rate confirmation', () => {
    expect(parseMoney('$1,250.00')).toBe(1250)
    expect(parseMoney('2450')).toBe(2450)
    expect(parseMoney('$ 1,250.50')).toBe(1250.5)
  })

  it('returns null when there is no number', () => {
    expect(parseMoney('')).toBeNull()
    expect(parseMoney(null)).toBeNull()
  })
})

describe('parseWeight', () => {
  it('returns the value and normalises the unit', () => {
    expect(parseWeight('38,500 lbs')).toEqual([38500, 'L'])
    expect(parseWeight('17500 KG')).toEqual([17500, 'K'])
  })

  it('defaults to pounds when the unit is missing', () => {
    expect(parseWeight('42000')).toEqual([42000, 'L'])
  })

  it('returns a null pair on junk', () => {
    expect(parseWeight('')).toEqual([null, null])
    expect(parseWeight(null)).toEqual([null, null])
  })
})

describe('equipmentCode', () => {
  it('maps trailer descriptions to X12 equipment codes', () => {
    const [dryVan] = equipmentCode("53' Dry Van")
    const [reefer] = equipmentCode('Reefer -10F')
    expect(dryVan).toBeTruthy()
    expect(reefer).toBeTruthy()
    expect(dryVan).not.toBe(reefer)
  })

  it('returns a null pair for equipment it does not recognise', () => {
    expect(equipmentCode('teleporter')).toEqual([null, null])
    expect(equipmentCode('')).toEqual([null, null])
  })
})

describe('fixOcrDigits', () => {
  // Despite the name this is narrow and specific: it repairs date SEPARATORS
  // that OCR mangled, not digits in general. A scanner reads the slashes in
  // 08/20/2026 as 7s or 1s constantly, and without this the date pattern
  // never matches and the load arrives with no pickup date.
  it('repairs separators a scanner misread as digits', () => {
    expect(fixOcrDigits('08720/2026')).toBe('08/20/2026')
    expect(fixOcrDigits('08/2072026')).toBe('08/20/2026')
  })

  it('repairs a dropped or punctuated second separator', () => {
    expect(fixOcrDigits('03/1620')).toBe('03/16/20')
    expect(fixOcrDigits('03/17:20')).toBe('03/17/20')
  })

  it('leaves anything that is not a mangled date alone', () => {
    expect(fixOcrDigits('ABC')).toBe('ABC')
    expect(fixOcrDigits('2026-08-20')).toBe('2026-08-20')
  })
})

describe('harvestReferences', () => {
  it('finds reference numbers and assigns X12 qualifiers', () => {
    const refs = harvestReferences('PO# 4472281  BOL 99183  SEAL 771244')
    const values = refs.map((r) => String(r.value.v))
    expect(values).toContain('4472281')
    expect(values).toContain('99183')
    expect(refs.every((r) => Boolean(r.qualifier.v))).toBe(true)
  })

  it('recovers a PO number that OCR mangled into P0', () => {
    // "PO6948654" scans as "P06948654" constantly; missing it loses the
    // customer's own order number.
    const refs = harvestReferences('P06948654')
    expect(refs.map((r) => String(r.value.v))).toContain('6948654')
  })

  it('does not emit the same reference twice', () => {
    const refs = harvestReferences('PO 4472281 and again PO 4472281')
    const keys = refs.map((r) => `${r.qualifier.v}|${r.value.v}`)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('returns an empty list for text with no references', () => {
    expect(harvestReferences('')).toEqual([])
    expect(harvestReferences('driver check-in at gate 4')).toEqual([])
  })
})

describe('normPhone', () => {
  it('normalises the phone formats found on paperwork', () => {
    const a = normPhone('(404) 555-1212')
    const b = normPhone('404.555.1212')
    expect(a).toBeTruthy()
    expect(a).toBe(b)
  })
})
