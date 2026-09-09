/**
 * Load board flags.
 *
 * Two different rule sets, because an unbooked load and a booked load are
 * urgent for opposite reasons:
 *
 * UNBOOKED (no carrier yet) — the flag is "this ships soon and nobody has
 *   covered it." Colored purely by time until first pickup:
 *     green   > 72h out
 *     yellow  <= 72h
 *     orange  <= 24h
 *     red     <= 3h, or already past pickup
 *
 * BOOKED (carrier assigned) — the clock alone isn't the story; what matters is
 *   whether anyone has actually touched the load. A load picking up in an hour
 *   with a check call logged is fine. The same load with no check call is the
 *   one that burns you. So:
 *     red     pickup within 2h and no tracking event ever logged
 *     orange  pickup within 6h and no tracking event ever logged
 *     yellow  no touch in the last 24h (stale), or pickup is imminent but tracked
 *     green   tracked and not stale
 *
 * Every tier is a switch plus an hour cutoff. The cutoffs are org-wide and
 * live in `org_settings.flag_rules`; the switches can additionally be turned
 * off per team or per user (see src/lib/view-prefs.ts) — the check-call team
 * has no use for unbooked flags, so theirs are off. A tier that is switched
 * off simply doesn't fire: the load falls through to the next tier down.
 */

import type { Band } from './qc-bands'
import type { StagePhase } from '@/types/db'

export interface FlagTier {
  enabled: boolean
  hours: number
}

export interface UnbookedFlagRules {
  enabled: boolean
  yellow: FlagTier
  orange: FlagTier
  red: FlagTier
}

export interface BookedFlagRules {
  enabled: boolean
  red_no_checkcall: FlagTier
  orange_no_checkcall: FlagTier
  stale: FlagTier
}

export interface FlagRules {
  unbooked: UnbookedFlagRules
  booked: BookedFlagRules
}

export const DEFAULT_FLAG_RULES: FlagRules = {
  unbooked: {
    enabled: true,
    yellow: { enabled: true, hours: 72 },
    orange: { enabled: true, hours: 24 },
    red: { enabled: true, hours: 3 },
  },
  booked: {
    enabled: true,
    red_no_checkcall: { enabled: true, hours: 2 },
    orange_no_checkcall: { enabled: true, hours: 6 },
    stale: { enabled: true, hours: 24 },
  },
}

/**
 * The pre-Phase-2 shape (`urgency_rules`), still accepted so a settings row
 * that was never migrated keeps colouring the board.
 */
export interface LegacyUrgencyRules {
  unbooked: { yellow_hours: number; orange_hours: number; red_hours: number }
  booked: {
    red_hours_no_checkcall: number
    orange_hours_no_checkcall: number
    stale_touch_hours: number
  }
}

export function fromLegacyUrgencyRules(legacy: Partial<LegacyUrgencyRules> | null | undefined): FlagRules {
  const u = legacy?.unbooked
  const b = legacy?.booked
  return {
    unbooked: {
      enabled: true,
      yellow: { enabled: true, hours: u?.yellow_hours ?? DEFAULT_FLAG_RULES.unbooked.yellow.hours },
      orange: { enabled: true, hours: u?.orange_hours ?? DEFAULT_FLAG_RULES.unbooked.orange.hours },
      red: { enabled: true, hours: u?.red_hours ?? DEFAULT_FLAG_RULES.unbooked.red.hours },
    },
    booked: {
      enabled: true,
      red_no_checkcall: {
        enabled: true,
        hours: b?.red_hours_no_checkcall ?? DEFAULT_FLAG_RULES.booked.red_no_checkcall.hours,
      },
      orange_no_checkcall: {
        enabled: true,
        hours: b?.orange_hours_no_checkcall ?? DEFAULT_FLAG_RULES.booked.orange_no_checkcall.hours,
      },
      stale: { enabled: true, hours: b?.stale_touch_hours ?? DEFAULT_FLAG_RULES.booked.stale.hours },
    },
  }
}

/** Deep-merge a partial rules object (as stored in JSON) over the defaults. */
export function normalizeFlagRules(raw: unknown): FlagRules {
  const r = (raw ?? {}) as Partial<{
    unbooked: Partial<UnbookedFlagRules>
    booked: Partial<BookedFlagRules>
  }>
  const tier = (t: Partial<FlagTier> | undefined, d: FlagTier): FlagTier => ({
    enabled: typeof t?.enabled === 'boolean' ? t.enabled : d.enabled,
    hours: typeof t?.hours === 'number' && Number.isFinite(t.hours) ? t.hours : d.hours,
  })
  const D = DEFAULT_FLAG_RULES
  return {
    unbooked: {
      enabled: typeof r.unbooked?.enabled === 'boolean' ? r.unbooked.enabled : D.unbooked.enabled,
      yellow: tier(r.unbooked?.yellow, D.unbooked.yellow),
      orange: tier(r.unbooked?.orange, D.unbooked.orange),
      red: tier(r.unbooked?.red, D.unbooked.red),
    },
    booked: {
      enabled: typeof r.booked?.enabled === 'boolean' ? r.booked.enabled : D.booked.enabled,
      red_no_checkcall: tier(r.booked?.red_no_checkcall, D.booked.red_no_checkcall),
      orange_no_checkcall: tier(r.booked?.orange_no_checkcall, D.booked.orange_no_checkcall),
      stale: tier(r.booked?.stale, D.booked.stale),
    },
  }
}

export interface UrgencyInput {
  /** Whether the load has reached a stage where a carrier is on it. */
  isBooked: boolean
  /** First pickup appointment/ready time. */
  firstPickupAt: string | null
  /** Whether any tracking event (check call etc.) has ever been logged. */
  hasTrackingEvent: boolean
  /** Last time anyone touched the load. */
  lastTouchedAt: string | null
  /** Terminal loads (paid/cancelled) never scream for attention. */
  isTerminal?: boolean
  /**
   * Where the load is in its life. Decides which rule set applies — see
   * `phaseOf`. When absent it is derived from isBooked/isTerminal, which
   * cannot tell "in transit" or "delivered" apart from "booked", so pass it.
   */
  phase?: StagePhase | null
}

function phaseOf(input: UrgencyInput): StagePhase {
  if (input.phase) return input.phase
  if (input.isTerminal) return 'closed'
  return input.isBooked ? 'pre_pickup' : 'pre_booking'
}

export interface UrgencyResult {
  band: Band
  /** Short human explanation — shown on hover so the color is never a mystery. */
  reason: string
  /** Hours until pickup; negative means pickup time has passed. */
  hoursToPickup: number | null
}

function hoursBetween(fromIso: string | null, now: Date): number | null {
  if (!fromIso) return null
  const t = new Date(fromIso).getTime()
  if (Number.isNaN(t)) return null
  return (t - now.getTime()) / 3_600_000
}

export function urgencyFor(
  input: UrgencyInput,
  rules: FlagRules = DEFAULT_FLAG_RULES,
  now: Date = new Date(),
): UrgencyResult {
  const hoursToPickup = hoursBetween(input.firstPickupAt, now)
  const phase = phaseOf(input)

  if (phase === 'closed') {
    return { band: 'none', reason: 'Closed', hoursToPickup }
  }
  if (phase === 'post_delivery') {
    // Billing stages. Nothing on the board can be chased by phone any more.
    return { band: 'none', reason: 'Delivered — nothing left to chase on the board', hoursToPickup }
  }

  if (phase === 'pre_booking') {
    const r = rules.unbooked
    if (!r.enabled) {
      return { band: 'none', reason: 'Unbooked flags are off', hoursToPickup }
    }
    if (hoursToPickup === null) {
      return { band: 'none', reason: 'No pickup time on the load yet', hoursToPickup }
    }
    if (r.red.enabled && hoursToPickup <= 0) {
      return { band: 'red', reason: 'Pickup time has passed and no carrier is booked', hoursToPickup }
    }
    if (r.red.enabled && hoursToPickup <= r.red.hours) {
      return {
        band: 'red',
        reason: `Ships in ${formatHours(hoursToPickup)} and still needs a carrier`,
        hoursToPickup,
      }
    }
    if (r.orange.enabled && hoursToPickup <= r.orange.hours) {
      return {
        band: 'orange',
        reason: `Ships ${describeLead(hoursToPickup)} — needs covering`,
        hoursToPickup,
      }
    }
    if (r.yellow.enabled && hoursToPickup <= r.yellow.hours) {
      return { band: 'yellow', reason: `Ships ${describeLead(hoursToPickup)}`, hoursToPickup }
    }
    return { band: 'green', reason: `Ships ${describeLead(hoursToPickup)}`, hoursToPickup }
  }

  // Booked: attention is driven by tracking, not just the clock.
  const r = rules.booked
  if (!r.enabled) {
    return { band: 'none', reason: 'Booked flags are off', hoursToPickup }
  }

  // The "no check call before pickup" tiers only make sense while the truck
  // has not yet loaded. Once it is rolling the question is whether anyone
  // is still hearing from the driver — that is the gone-quiet rule below.
  if (phase === 'pre_pickup' && !input.hasTrackingEvent && hoursToPickup !== null) {
    if (r.red_no_checkcall.enabled && hoursToPickup <= r.red_no_checkcall.hours) {
      return {
        band: 'red',
        reason:
          hoursToPickup <= 0
            ? 'Pickup time has passed with no check call logged'
            : `Picks up in ${formatHours(hoursToPickup)} with no check call logged`,
        hoursToPickup,
      }
    }
    if (r.orange_no_checkcall.enabled && hoursToPickup <= r.orange_no_checkcall.hours) {
      return {
        band: 'orange',
        reason: `Picks up ${describeLead(hoursToPickup)} — no check call yet`,
        hoursToPickup,
      }
    }
  }

  const hoursSinceTouch = input.lastTouchedAt
    ? -(hoursBetween(input.lastTouchedAt, now) ?? 0)
    : null
  if (r.stale.enabled && hoursSinceTouch !== null && hoursSinceTouch >= r.stale.hours) {
    return {
      band: 'yellow',
      reason: `Not touched in ${formatHours(hoursSinceTouch)}`,
      hoursToPickup,
    }
  }

  if (!input.hasTrackingEvent) {
    return {
      band: 'yellow',
      reason: phase === 'in_transit' ? 'In transit, no check call logged' : 'Booked, no check call logged yet',
      hoursToPickup,
    }
  }

  return {
    band: 'green',
    reason: phase === 'in_transit' ? 'In transit and tracking' : 'Booked and tracking',
    hoursToPickup,
  }
}

export function formatHours(h: number): string {
  const abs = Math.abs(h)
  if (abs < 1) return `${Math.round(abs * 60)}m`
  if (abs < 48) return `${Math.round(abs)}h`
  return `${Math.round(abs / 24)}d`
}

/** "in 4h" for a future pickup, "2h ago" for a missed one. */
function describeLead(h: number): string {
  return h >= 0 ? `in ${formatHours(h)}` : `${formatHours(h)} ago`
}

/** "in 4h" / "3h ago" for a timestamp, relative to now. */
export function relativeTime(iso: string | null, now: Date = new Date()): string {
  const h = hoursBetween(iso, now)
  if (h === null) return '—'
  if (Math.abs(h) < 0.02) return 'now'
  return h > 0 ? `in ${formatHours(h)}` : `${formatHours(h)} ago`
}
