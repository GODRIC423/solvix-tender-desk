import { describe, expect, it } from 'vitest'
import { applyViewPrefs, resolveViewPrefs, ORG_DEFAULT_VIEW } from './view-prefs'
import { DEFAULT_FLAG_RULES } from './urgency'

describe('resolving who sees what', () => {
  it('is the org default when nobody set anything', () => {
    expect(resolveViewPrefs(undefined, null)).toEqual(ORG_DEFAULT_VIEW)
  })

  it('a team default narrows the org default', () => {
    const v = resolveViewPrefs({ show_unbooked: false })
    expect(v.show_unbooked).toBe(false)
    expect(v.show_booked).toBe(true)
  })

  it('the user wins over their team', () => {
    // Team says no unbooked; this one dispatcher wants them anyway.
    const v = resolveViewPrefs({ show_unbooked: false }, { show_unbooked: true })
    expect(v.show_unbooked).toBe(true)
  })

  it('an unset user key inherits from the team, not the org', () => {
    const v = resolveViewPrefs({ show_booked: false }, { show_unbooked: true })
    expect(v.show_booked).toBe(false)
  })

  it('tier switches nest the same way', () => {
    const v = resolveViewPrefs(
      { flags: { unbooked: { enabled: false } } },
      { flags: { booked: { stale: false } } },
    )
    expect(v.flags.unbooked.enabled).toBe(false)
    expect(v.flags.booked.stale).toBe(false)
    expect(v.flags.booked.red_no_checkcall).toBe(true)
  })
})

describe('applying a view to the org rules', () => {
  it('leaves the cutoffs alone', () => {
    const r = applyViewPrefs(DEFAULT_FLAG_RULES, ORG_DEFAULT_VIEW)
    expect(r).toEqual(DEFAULT_FLAG_RULES)
  })

  it('a viewer can switch a tier off', () => {
    const view = resolveViewPrefs({ flags: { unbooked: { red: false } } })
    const r = applyViewPrefs(DEFAULT_FLAG_RULES, view)
    expect(r.unbooked.red.enabled).toBe(false)
    expect(r.unbooked.red.hours).toBe(3)
  })

  it('a viewer cannot switch on a tier the org turned off', () => {
    const orgOff = {
      ...DEFAULT_FLAG_RULES,
      booked: { ...DEFAULT_FLAG_RULES.booked, stale: { enabled: false, hours: 24 } },
    }
    const view = resolveViewPrefs({ flags: { booked: { stale: true } } })
    expect(applyViewPrefs(orgOff, view).booked.stale.enabled).toBe(false)
  })

  it('the check-call team preset: no unbooked flags, booked flags intact', () => {
    const view = resolveViewPrefs({ show_unbooked: false, flags: { unbooked: { enabled: false } } })
    const r = applyViewPrefs(DEFAULT_FLAG_RULES, view)
    expect(r.unbooked.enabled).toBe(false)
    expect(r.booked.enabled).toBe(true)
    expect(view.show_unbooked).toBe(false)
  })
})
