import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FLAG_RULES,
  fromLegacyUrgencyRules,
  normalizeFlagRules,
  urgencyFor,
  type FlagRules,
  type UrgencyInput,
} from './urgency'

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

const band = (o: Partial<UrgencyInput>, rules: FlagRules = DEFAULT_FLAG_RULES) =>
  urgencyFor(input(o), rules, NOW).band

/** Copy the defaults with one tier switched off. */
function withTierOff(path: string): FlagRules {
  const r: FlagRules = JSON.parse(JSON.stringify(DEFAULT_FLAG_RULES))
  const [side, tier] = path.split('.') as ['unbooked' | 'booked', string]
  if (tier === 'enabled') {
    r[side].enabled = false
  } else {
    ;(r[side] as unknown as Record<string, { enabled: boolean }>)[tier].enabled = false
  }
  return r
}

describe('unbooked loads: the flag is the clock', () => {
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
    expect(band({ firstPickupAt: at(72) })).toBe('yellow')
    expect(band({ firstPickupAt: at(24) })).toBe('orange')
    expect(band({ firstPickupAt: at(3) })).toBe('red')
  })

  it('reports no flag when the load has no pickup time yet', () => {
    expect(band({ firstPickupAt: null })).toBe('none')
  })
})

describe('booked loads: the flag is whether anyone has touched it', () => {
  const booked = (o: Partial<UrgencyInput> = {}, rules?: FlagRules) =>
    band({ isBooked: true, ...o }, rules)

  it('is red when pickup is imminent and no check call was ever logged', () => {
    expect(booked({ firstPickupAt: at(1), hasTrackingEvent: false })).toBe('red')
  })

  it('is NOT red at the same moment once a check call exists', () => {
    expect(booked({ firstPickupAt: at(1), hasTrackingEvent: true })).not.toBe('red')
  })

  it('is orange a few hours out with no check call', () => {
    expect(booked({ firstPickupAt: at(5), hasTrackingEvent: false })).toBe('orange')
  })

  it('is red after the pickup time passed with no check call', () => {
    expect(booked({ firstPickupAt: at(-2), hasTrackingEvent: false })).toBe('red')
  })

  it('goes yellow when it has not been touched in over a day', () => {
    expect(booked({ firstPickupAt: at(50), hasTrackingEvent: true, lastTouchedAt: at(-25) })).toBe(
      'yellow',
    )
  })

  it('is yellow when booked, tracked recently, but never had a check call', () => {
    expect(booked({ firstPickupAt: at(50), hasTrackingEvent: false, lastTouchedAt: at(-1) })).toBe(
      'yellow',
    )
  })

  it('is green when tracked and fresh', () => {
    expect(booked({ firstPickupAt: at(50), hasTrackingEvent: true, lastTouchedAt: at(-1) })).toBe(
      'green',
    )
  })

  it('never flags a closed load', () => {
    expect(booked({ firstPickupAt: at(-10), hasTrackingEvent: false, isTerminal: true })).toBe('none')
  })
})

describe('the stage phase decides which rules apply', () => {
  it('a delivered load is never flagged, however late the pickup was', () => {
    expect(band({ isBooked: true, phase: 'post_delivery', firstPickupAt: at(-800), hasTrackingEvent: false })).toBe('none')
  })

  it('an invoiced load is the same', () => {
    expect(band({ isBooked: true, phase: 'post_delivery', firstPickupAt: at(-40), hasTrackingEvent: false, lastTouchedAt: at(-200) })).toBe('none')
  })

  it('in transit: a passed pickup with no check call is yellow, not red', () => {
    // The truck is rolling — "no check call before pickup" no longer applies.
    expect(band({ isBooked: true, phase: 'in_transit', firstPickupAt: at(-3), hasTrackingEvent: false })).toBe('yellow')
  })

  it('in transit: gone quiet is still yellow', () => {
    expect(band({ isBooked: true, phase: 'in_transit', firstPickupAt: at(-30), hasTrackingEvent: true, lastTouchedAt: at(-30) })).toBe('yellow')
  })

  it('in transit: tracked and fresh is green', () => {
    expect(band({ isBooked: true, phase: 'in_transit', firstPickupAt: at(-3), hasTrackingEvent: true, lastTouchedAt: at(-1) })).toBe('green')
  })

  it('pre-pickup: the original booked rules apply unchanged', () => {
    expect(band({ isBooked: true, phase: 'pre_pickup', firstPickupAt: at(1), hasTrackingEvent: false })).toBe('red')
  })

  it('pre-booking: the unbooked rules apply even if isBooked is stale', () => {
    expect(band({ isBooked: true, phase: 'pre_booking', firstPickupAt: at(1), hasTrackingEvent: true })).toBe('red')
  })

  it('without a phase, isBooked/isTerminal still decide (older callers)', () => {
    expect(band({ isBooked: true, firstPickupAt: at(1), hasTrackingEvent: false })).toBe('red')
    expect(band({ isBooked: true, isTerminal: true, firstPickupAt: at(-10), hasTrackingEvent: false })).toBe('none')
  })
})

describe('switching a tier off makes the load fall through to the next tier', () => {
  it('unbooked red off: a 2h-out load reads orange instead', () => {
    expect(band({ firstPickupAt: at(2) }, withTierOff('unbooked.red'))).toBe('orange')
  })

  it('unbooked red off: even a missed pickup is only orange', () => {
    expect(band({ firstPickupAt: at(-1) }, withTierOff('unbooked.red'))).toBe('orange')
  })

  it('unbooked orange off: a 10h-out load reads yellow', () => {
    expect(band({ firstPickupAt: at(10) }, withTierOff('unbooked.orange'))).toBe('yellow')
  })

  it('unbooked yellow off: a 50h-out load reads green', () => {
    expect(band({ firstPickupAt: at(50) }, withTierOff('unbooked.yellow'))).toBe('green')
  })

  it('all unbooked flags off: no colour at all, whatever the clock says', () => {
    const rules = withTierOff('unbooked.enabled')
    expect(band({ firstPickupAt: at(-5) }, rules)).toBe('none')
    expect(band({ firstPickupAt: at(1) }, rules)).toBe('none')
  })

  it('booked red-no-checkcall off: an untracked load 1h out is orange', () => {
    expect(
      band({ isBooked: true, firstPickupAt: at(1), hasTrackingEvent: false }, withTierOff('booked.red_no_checkcall')),
    ).toBe('orange')
  })

  it('booked stale off: an untouched-for-days load stays green', () => {
    expect(
      band(
        { isBooked: true, firstPickupAt: at(50), hasTrackingEvent: true, lastTouchedAt: at(-72) },
        withTierOff('booked.stale'),
      ),
    ).toBe('green')
  })

  it('all booked flags off: the check-call team sees no colour on unbooked-style problems', () => {
    expect(
      band({ isBooked: true, firstPickupAt: at(-1), hasTrackingEvent: false }, withTierOff('booked.enabled')),
    ).toBe('none')
  })
})

describe('reading rules out of JSON', () => {
  it('fills every gap from the defaults', () => {
    const r = normalizeFlagRules({ unbooked: { red: { hours: 1 } } })
    expect(r.unbooked.red).toEqual({ enabled: true, hours: 1 })
    expect(r.unbooked.yellow).toEqual(DEFAULT_FLAG_RULES.unbooked.yellow)
    expect(r.booked).toEqual(DEFAULT_FLAG_RULES.booked)
  })

  it('keeps an explicit false', () => {
    const r = normalizeFlagRules({ booked: { stale: { enabled: false } } })
    expect(r.booked.stale.enabled).toBe(false)
    expect(r.booked.stale.hours).toBe(24)
  })

  it('ignores garbage hours', () => {
    const r = normalizeFlagRules({ unbooked: { yellow: { hours: 'soon' } } })
    expect(r.unbooked.yellow.hours).toBe(72)
  })

  it('carries a pre-Phase-2 urgency_rules row across with every switch on', () => {
    const r = fromLegacyUrgencyRules({
      unbooked: { yellow_hours: 48, orange_hours: 12, red_hours: 2 },
      booked: { red_hours_no_checkcall: 1, orange_hours_no_checkcall: 4, stale_touch_hours: 12 },
    })
    expect(r.unbooked.yellow).toEqual({ enabled: true, hours: 48 })
    expect(r.unbooked.red).toEqual({ enabled: true, hours: 2 })
    expect(r.booked.stale).toEqual({ enabled: true, hours: 12 })
  })
})
