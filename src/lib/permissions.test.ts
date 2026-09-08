import { describe, expect, it } from 'vitest'
import {
  FALLBACK_ROLE_PERMISSIONS,
  PERMISSION_KEYS,
  hasPermission,
  permissionSource,
  resolvePermissions,
} from './permissions'

const admin = { role: 'admin' as const, active: true, permissions: {} }
const dispatcher = { role: 'dispatcher' as const, active: true, permissions: {} }
const viewer = { role: 'viewer' as const, active: true, permissions: {} }

describe('permission resolution', () => {
  it('admins have everything, even keys nobody has heard of yet', () => {
    for (const k of PERMISSION_KEYS) expect(hasPermission(admin, k)).toBe(true)
  })

  it('an admin cannot be restricted by their own overrides', () => {
    expect(hasPermission({ ...admin, permissions: { export_carriers: false } }, 'export_carriers')).toBe(true)
  })

  it('a deactivated user has nothing, whatever their role', () => {
    expect(hasPermission({ ...admin, active: false }, 'create_loads')).toBe(false)
  })

  it('a signed-out user has nothing', () => {
    expect(hasPermission(null, 'create_loads')).toBe(false)
  })

  it('dispatchers get the role defaults', () => {
    expect(hasPermission(dispatcher, 'create_loads')).toBe(true)
    expect(hasPermission(dispatcher, 'export_carriers')).toBe(false)
    expect(hasPermission(dispatcher, 'view_reports')).toBe(false)
  })

  it('viewers get nothing by default', () => {
    for (const k of PERMISSION_KEYS) expect(hasPermission(viewer, k)).toBe(false)
  })

  it('a per-user grant beats the role default', () => {
    expect(
      hasPermission({ ...dispatcher, permissions: { export_carriers: true } }, 'export_carriers'),
    ).toBe(true)
  })

  it('a per-user revoke beats the role default', () => {
    expect(hasPermission({ ...dispatcher, permissions: { create_loads: false } }, 'create_loads')).toBe(
      false,
    )
  })

  it('reads role defaults from org settings when given', () => {
    const custom = { dispatcher: { view_reports: true } }
    expect(hasPermission(dispatcher, 'view_reports', custom)).toBe(true)
    // ...and anything the custom set omits is denied, not defaulted from the fallback.
    expect(hasPermission(dispatcher, 'create_loads', custom)).toBe(false)
  })

  it('resolvePermissions covers every key', () => {
    const all = resolvePermissions(dispatcher, FALLBACK_ROLE_PERMISSIONS)
    expect(Object.keys(all).sort()).toEqual([...PERMISSION_KEYS].sort())
  })

  it('reports where a value came from', () => {
    expect(permissionSource(admin, 'create_loads')).toBe('admin')
    expect(permissionSource(dispatcher, 'create_loads')).toBe('role')
    expect(permissionSource({ ...dispatcher, permissions: { create_loads: false } }, 'create_loads')).toBe(
      'override',
    )
  })
})
