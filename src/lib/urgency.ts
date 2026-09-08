/**
 * Load board urgency coloring.
 *
 * Two different rules, because an unbooked load and a booked load are urgent
 * for opposite reasons:
 *
 * UNBOOKED (no carrier yet) — urgency is "this ships soon and nobody has
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
 * Thresholds come from `org_settings.urgency_rules` — the numbers below are
 * only the fallback. They are meant to be tuned after real use.
 */

import type { Band } from './qc-bands'

export interface UnbookedUrgencyRules {
  yellow_hours: number
  orange_hours: number
  red_hours: number
}

export interface BookedUrgencyRules {
  red_hours_no_checkcall: number
  orange_hours_no_checkcall: number
  stale_touch_hours: number
}

export interface UrgencyRules {
  unbooked: UnbookedUrgencyRules
  booked: BookedUrgencyRules
}

export const DEFAULT_URGENCY_RULES: UrgencyRules = {
  unbooked: { yellow_hours: 72, orange_hours: 24, red_hours: 3 },
  booked: { red_hours_no_checkcall: 2, orange_hours_no_checkcall: 6, stale_touch_hours: 24 },
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
  /** Terminal loads (delivered/paid/cancelled) never scream for attention. */
  isTerminal?: boolean
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
  rules: UrgencyRules = DEFAULT_URGENCY_RULES,
  now: Date = new Date(),
): UrgencyResult {
  const hoursToPickup = hoursBetween(input.firstPickupAt, now)

  if (input.isTerminal) {
    return { band: 'none', reason: 'Closed', hoursToPickup }
  }

  if (!input.isBooked) {
    const r = rules.unbooked
    if (hoursToPickup === null) {
      return { band: 'none', reason: 'No pickup time on the load yet', hoursToPickup }
    }
    if (hoursToPickup <= 0) {
      return { band: 'red', reason: 'Pickup time has passed and no carrier is booked', hoursToPickup }
    }
    if (hoursToPickup <= r.red_hours) {
      return {
        band: 'red',
        reason: `Ships in ${formatHours(hoursToPickup)} and still needs a carrier`,
        hoursToPickup,
      }
    }
    if (hoursToPickup <= r.orange_hours) {
      return {
        band: 'orange',
        reason: `Ships in ${formatHours(hoursToPickup)} — needs covering`,
        hoursToPickup,
      }
    }
    if (hoursToPickup <= r.yellow_hours) {
      return { band: 'yellow', reason: `Ships in ${formatHours(hoursToPickup)}`, hoursToPickup }
    }
    return { band: 'green', reason: `Ships in ${formatHours(hoursToPickup)}`, hoursToPickup }
  }

  // Booked: attention is driven by tracking, not just the clock.
  const r = rules.booked
  if (!input.hasTrackingEvent && hoursToPickup !== null) {
    if (hoursToPickup <= r.red_hours_no_checkcall) {
      return {
        band: 'red',
        reason:
          hoursToPickup <= 0
            ? 'Pickup time has passed with no check call logged'
            : `Picks up in ${formatHours(hoursToPickup)} with no check call logged`,
        hoursToPickup,
      }
    }
    if (hoursToPickup <= r.orange_hours_no_checkcall) {
      return {
        band: 'orange',
        reason: `Picks up in ${formatHours(hoursToPickup)} — no check call yet`,
        hoursToPickup,
      }
    }
  }

  const hoursSinceTouch = input.lastTouchedAt
    ? -(hoursBetween(input.lastTouchedAt, now) ?? 0)
    : null
  if (hoursSinceTouch !== null && hoursSinceTouch >= r.stale_touch_hours) {
    return {
      band: 'yellow',
      reason: `Not touched in ${formatHours(hoursSinceTouch)}`,
      hoursToPickup,
    }
  }

  if (!input.hasTrackingEvent) {
    return { band: 'yellow', reason: 'Booked, no check call logged yet', hoursToPickup }
  }

  return { band: 'green', reason: 'Booked and tracking', hoursToPickup }
}

export function formatHours(h: number): string {
  const abs = Math.abs(h)
  if (abs < 1) return `${Math.round(abs * 60)}m`
  if (abs < 48) return `${Math.round(abs)}h`
  return `${Math.round(abs / 24)}d`
}

/** "in 4h" / "3h ago" for a timestamp, relative to now. */
export function relativeTime(iso: string | null, now: Date = new Date()): string {
  const h = hoursBetween(iso, now)
  if (h === null) return '—'
  if (Math.abs(h) < 0.02) return 'now'
  return h > 0 ? `in ${formatHours(h)}` : `${formatHours(h)} ago`
}
