import { describe, expect, it } from 'vitest'
import {
  carrierPayLinesForLoad,
  documentFileName,
  dueDate,
  hazmatRefs,
  insuranceHealth,
  invoiceLinesForLoad,
  money,
  nextVersion,
  policyHealth,
  sumLines,
  tempText,
} from './data'

const lane = { origin_city: 'Marietta', origin_state: 'GA', dest_city: 'Houston', dest_state: 'TX' }

describe('what a load bills and pays', () => {
  it('turns the customer rate into a linehaul line with the lane on it', () => {
    const [line] = invoiceLinesForLoad({ ...lane, customer_rate: 2250 }, [])
    expect(line.description).toBe('Linehaul — Marietta, GA → Houston, TX')
    expect(line.amount).toBe(2250)
  })

  it('adds customer-side charges and leaves carrier-side ones alone', () => {
    const lines = invoiceLinesForLoad({ ...lane, customer_rate: 2000 }, [
      { side: 'customer', description: 'Lumper', accessorial_code: null, quantity: 1, rate: 150, amount: 150 },
      { side: 'carrier', description: 'Detention', accessorial_code: null, quantity: 2, rate: 50, amount: null },
    ])
    expect(lines.map((l) => l.description)).toEqual(['Linehaul — Marietta, GA → Houston, TX', 'Lumper'])
    expect(sumLines(lines)).toBe(2150)
  })

  it('works a charge amount out from quantity × rate when it was not written down', () => {
    const lines = carrierPayLinesForLoad({ ...lane, carrier_rate: 1800 }, [
      { side: 'carrier', description: 'Detention', accessorial_code: null, quantity: 2, rate: 50, amount: null },
      { side: 'carrier', description: null, accessorial_code: 'TONU', quantity: null, rate: null, amount: null },
    ])
    expect(lines).toHaveLength(2) // the empty TONU charge is skipped
    expect(lines[1].description).toBe('Detention')
    expect(lines[1].amount).toBe(100)
    expect(sumLines(lines)).toBe(1900)
  })

  it('has no linehaul line when no rate was agreed yet', () => {
    expect(invoiceLinesForLoad({ ...lane, customer_rate: null }, [])).toEqual([])
  })

  it('sums to cents without floating-point crumbs', () => {
    expect(sumLines([{ amount: 0.1 }, { amount: 0.2 }])).toBe(0.3)
  })
})

describe('file naming and versions', () => {
  it('names the first copy plainly and later ones with a version', () => {
    expect(documentFileName('rate_confirmation', 'S2600012', 1)).toBe('S2600012-rate-confirmation.pdf')
    expect(documentFileName('bol', 'S2600012', 3)).toBe('S2600012-bol-v3.pdf')
  })

  it('continues the version count for that kind only', () => {
    const existing = [
      { kind: 'bol', version: 1 },
      { kind: 'bol', version: 3 },
      { kind: 'invoice', version: 7 },
    ]
    expect(nextVersion(existing, 'bol')).toBe(4)
    expect(nextVersion(existing, 'rate_confirmation')).toBe(1)
  })
})

describe('due dates', () => {
  it('adds the terms to the issue date', () => {
    expect(dueDate('2026-09-30', 30)).toBe('2026-10-30')
  })
  it('rolls over the year', () => {
    expect(dueDate('2026-12-15', 30)).toBe('2027-01-14')
  })
})

describe('is the insurance in date?', () => {
  it('reads the per-carrier summary', () => {
    expect(insuranceHealth(undefined)).toBe('none')
    expect(insuranceHealth({ policies: 0, expired: 0, expiring_30d: 0 })).toBe('none')
    expect(insuranceHealth({ policies: 2, expired: 1, expiring_30d: 0 })).toBe('expired')
    expect(insuranceHealth({ policies: 2, expired: 0, expiring_30d: 1 })).toBe('expiring')
    expect(insuranceHealth({ policies: 2, expired: 0, expiring_30d: 0 })).toBe('ok')
  })

  it('judges one policy against today', () => {
    const now = new Date(2026, 8, 20, 12)
    expect(policyHealth(null, now)).toBe('no_date')
    expect(policyHealth('2026-09-19', now)).toBe('expired')
    expect(policyHealth('2026-09-20', now)).toBe('expiring') // expires tonight
    expect(policyHealth('2026-10-15', now)).toBe('expiring')
    expect(policyHealth('2027-01-01', now)).toBe('ok')
  })
})

describe('print formatting', () => {
  it('formats money the way an invoice reads', () => {
    expect(money(2250)).toBe('$2,250.00')
    expect(money(null)).toBe('—')
  })

  it('describes a temperature range', () => {
    expect(tempText({ temp_min: 34, temp_max: 38 })).toBe('34° to 38° F')
    expect(tempText({ temp_min: null, temp_max: 40 })).toBe('40° F')
    expect(tempText({ temp_min: null, temp_max: null })).toBeNull()
  })

  it('finds UN/NA numbers among the references', () => {
    const refs = hazmatRefs([
      { label: 'PO', qualifier: 'PO', value: '40019' },
      { label: 'UN number', qualifier: 'UN', value: 'UN1993' },
      { label: 'Ref', qualifier: null, value: 'NA1993' },
    ])
    expect(refs).toEqual(['UN number UN1993', 'Ref NA1993'])
  })
})
