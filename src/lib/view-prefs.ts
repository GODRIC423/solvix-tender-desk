/**
 * Who sees what on the board.
 *
 * "The check-call team, we want them looking at the booked ones so they can
 * call the drivers. No use for them to see the unbooked flags." So the same
 * flag rules can be narrowed three ways, each one overriding the last:
 *
 *   org defaults  <  team defaults (org_settings.team_defaults[team])
 *                 <  the user's own preferences (profiles.preferences)
 *
 * Only the on/off switches can be narrowed here. The hour cutoffs are one
 * set for the whole desk — two dispatchers arguing about whether a load is
 * orange should be arguing about the load, not their settings.
 */

import type { ViewPrefs } from '@/types/db'
import type { FlagRules } from './urgency'

export interface ResolvedViewPrefs {
  show_unbooked: boolean
  show_booked: boolean
  flags: {
    unbooked: { enabled: boolean; yellow: boolean; orange: boolean; red: boolean }
    booked: {
      enabled: boolean
      red_no_checkcall: boolean
      orange_no_checkcall: boolean
      stale: boolean
    }
  }
}

export const ORG_DEFAULT_VIEW: ResolvedViewPrefs = {
  show_unbooked: true,
  show_booked: true,
  flags: {
    unbooked: { enabled: true, yellow: true, orange: true, red: true },
    booked: { enabled: true, red_no_checkcall: true, orange_no_checkcall: true, stale: true },
  },
}

function pick<T>(...values: Array<T | undefined>): T | undefined {
  for (let i = values.length - 1; i >= 0; i--) {
    if (values[i] !== undefined) return values[i]
  }
  return undefined
}

/**
 * Layer `layers` left-to-right (later wins) over the org default. Pass the
 * team default first and the user's prefs second.
 */
export function resolveViewPrefs(...layers: Array<ViewPrefs | null | undefined>): ResolvedViewPrefs {
  const L = layers.filter((l): l is ViewPrefs => Boolean(l))
  const D = ORG_DEFAULT_VIEW
  return {
    show_unbooked: pick(D.show_unbooked, ...L.map((l) => l.show_unbooked))!,
    show_booked: pick(D.show_booked, ...L.map((l) => l.show_booked))!,
    flags: {
      unbooked: {
        enabled: pick(D.flags.unbooked.enabled, ...L.map((l) => l.flags?.unbooked?.enabled))!,
        yellow: pick(D.flags.unbooked.yellow, ...L.map((l) => l.flags?.unbooked?.yellow))!,
        orange: pick(D.flags.unbooked.orange, ...L.map((l) => l.flags?.unbooked?.orange))!,
        red: pick(D.flags.unbooked.red, ...L.map((l) => l.flags?.unbooked?.red))!,
      },
      booked: {
        enabled: pick(D.flags.booked.enabled, ...L.map((l) => l.flags?.booked?.enabled))!,
        red_no_checkcall: pick(
          D.flags.booked.red_no_checkcall,
          ...L.map((l) => l.flags?.booked?.red_no_checkcall),
        )!,
        orange_no_checkcall: pick(
          D.flags.booked.orange_no_checkcall,
          ...L.map((l) => l.flags?.booked?.orange_no_checkcall),
        )!,
        stale: pick(D.flags.booked.stale, ...L.map((l) => l.flags?.booked?.stale))!,
      },
    },
  }
}

/**
 * The rules this viewer actually colours by: the org's cutoffs, with any tier
 * the viewer (or their team) switched off turned off. A tier the org has off
 * stays off — a user can narrow, never widen.
 */
export function applyViewPrefs(rules: FlagRules, view: ResolvedViewPrefs): FlagRules {
  const u = rules.unbooked
  const b = rules.booked
  const v = view.flags
  return {
    unbooked: {
      enabled: u.enabled && v.unbooked.enabled,
      yellow: { ...u.yellow, enabled: u.yellow.enabled && v.unbooked.yellow },
      orange: { ...u.orange, enabled: u.orange.enabled && v.unbooked.orange },
      red: { ...u.red, enabled: u.red.enabled && v.unbooked.red },
    },
    booked: {
      enabled: b.enabled && v.booked.enabled,
      red_no_checkcall: {
        ...b.red_no_checkcall,
        enabled: b.red_no_checkcall.enabled && v.booked.red_no_checkcall,
      },
      orange_no_checkcall: {
        ...b.orange_no_checkcall,
        enabled: b.orange_no_checkcall.enabled && v.booked.orange_no_checkcall,
      },
      stale: { ...b.stale, enabled: b.stale.enabled && v.booked.stale },
    },
  }
}
