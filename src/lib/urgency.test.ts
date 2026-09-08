import { describe, expect, it } from 'vitest'
import { urgencyFor, DEFAULT_URGENCY_RULES, type UrgencyInput } from './urgency'

// A fixed "now" so these never depend on when they run.
const NOW = new Date('2026-03-10T12:00:00Z')

function at(hoursFromNow: number): string {
  return new Date(NOW.getTime() + hoursFromNow * 3_600_000).toISOString()
}

function input(overrides: Partial<UrgencyInput> = {}): UrgencyInput {
  return {
    isBooked: false,
    firstPickupAt: at(100),
    hasTrackingEvent: false,
    lastTouchedAt: at(-1),
    isTerminal: false,
    ...overrides,
  }
}

const band = (o: Partial<UrgencyInput>) =>
  urgencyFor(input(o), DEFAULT_URGENCY_RULES, NOW).band

describe('unbooked loads: urgency is the clock', () => {
  it('is green when it ships well beyond the yellow window', () => {
    expect(band({ firstPickupAt: at(100) })).toBe('green')
  })

  it('turns yellow inside 72 hours', () => {
    expect(band({ firstPickupAt: at(71) })).toBe('yellow')
  })

  it('turns orange inside 24 hours', () => {
    expect(band({ firstPickupAt: at(23) })).toBe('orange')
  })

  it('turns red inside 3 hours', () => {
    expect(band({ firstPickupAt: at(2) })).toBe('red')
  })

  it('is red once the pickup time has passed with no carrier', () => {
    expect(band({ firstPickupAt: at(-1) })).toBe('red')
  })

  it('sits exactly on a boundary in the more urgent band', () => {
    // 72h out is "within 72 hours", not "beyond" it.
    expect(band({ firstPickupAt: at(72) })).toBe('yellow')
    expect(band({ firstPickupAt: at(24) })).toBe('orange')
    expect(band({ firstPickupAt: at(3) })).toBe('red')
  })

  it('reports no urgency when the load has no pickup time yet', () => {
    expect(band({ firstPickupAt: null })).toBe('none')
  })
})

describe('booked loads: urgency is whether anyone has touched it', () => {
  const booked = (o: Partial<UrgencyInput> = {}) => band({ isBooked: true, ...o })

  it('is red when pickup is imminent and no check call was ever logged', () => {
    expect(booked({ firstPickupAt: at(1), hasTrackingEvent: false })).toBe('red')
  })

  it('is NOT red at the same moment once a check call exists', () => {
    // This is the whole point of the booked rule: the clock alone is not the
    // problem, an untouched load is.
    expect(booked({ firstPickupAt: at(1), hasTrackingEvent: true })).not.toBe('red')
  })

  it('is orange a few hours out with no check call', () => {
    expect(booked({ firstPickupAt: at(5), hasTrackingEvent: false })).toBe('orange')
  })

  it('is red after the pickup time passed with no check call', () => {
    expect(booked({ firstPickupAt: at(-2), hasTrackingEvent: false })).toBe('red')
  })

  it('goes yellow when it has not been touched in over a day', () => {
    expect(
      booked({ firstPickupAt: at(200), hasTrackingEvent: true, lastTouchedAt: at(-30) }),
    ).toBe('yellow')
  })

  it('is green when tracked and recently touched', () => {
    expect(
      booked({ firstPickupAt: at(200), hasTrackingEvent: true, lastTouchedAt: at(-2) }),
    ).toBe('green')
  })

  it('is yellow when booked but never checked, even far out', () => {
    expect(
      booked({ firstPickupAt: at(200), hasTrackingEvent: false, lastTouchedAt: at(-1) }),
    ).toBe('yellow')
  })
})

describe('closed loads', () => {
  it('never demands attention, however overdue', () => {
    expect(band({ isTerminal: true, firstPickupAt: at(-500) })).toBe('none')
    expect(band({ isBooked: true, isTerminal: true, firstPickupAt: at(-500) })).toBe('none')
  })
})

describe('configured thresholds are respected', () => {
  it('uses the org settings rather than the defaults', () => {
    const tight = {
      unbooked: { yellow_hours: 12, orange_hours: 6, red_hours: 1 },
      booked: DEFAULT_URGENCY_RULES.booked,
    }
    // 24h out is green under these tighter rules, but orange under the defaults.
    expect(urgencyFor(input({ firstPickupAt: at(24) }), tight, NOW).band).toBe('green')
    expect(urgencyFor(input({ firstPickupAt: at(24) }), DEFAULT_URGENCY_RULES, NOW).band).toBe(
      'orange',
    )
  })
})

describe('every result explains itself', () => {
  it('carries a human reason for the colour', () => {
    const result = urgencyFor(input({ firstPickupAt: at(2) }), DEFAULT_URGENCY_RULES, NOW)
    expect(result.reason).toBeTruthy()
    expect(result.reason.toLowerCase()).toContain('carrier')
  })
})
