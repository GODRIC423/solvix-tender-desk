/**
 * Permissions.
 *
 * The desk's owner put it plainly: "I don't want to leave ourselves open to
 * anything that could give us misuse or abuse of the information." So every
 * feature that moves data in bulk, or out of the building, is behind a named
 * permission an admin can switch per user.
 *
 * Resolution order (mirrors `has_permission()` in the database, which is what
 * actually enforces the import and load-creation paths — this file only
 * decides what to render):
 *
 *   1. admin                                -> everything
 *   2. profiles.permissions[key]            -> the per-user override
 *   3. org_settings.role_permissions[role]  -> the role default
 *   4. false
 *
 * Both sides read the same `role_permissions` JSON from the database so there
 * is one source of defaults, not two that drift.
 */

import type { Profile, Role } from '@/types/db'

export const PERMISSION_KEYS = [
  'create_loads',
  'edit_loads',
  'delete_loads',
  'import_carriers',
  'export_carriers',
  'import_customers',
  'export_customers',
  'view_reports',
  'manage_users',
  'manage_settings',
] as const

export type PermissionKey = (typeof PERMISSION_KEYS)[number]

export interface PermissionMeta {
  label: string
  description: string
  group: 'Loads' | 'Carriers' | 'Customers' | 'Reports' | 'Admin'
  /** True for the ones that let data leave the system — shown with a warning tone. */
  sensitive?: boolean
}

export const PERMISSIONS: Record<PermissionKey, PermissionMeta> = {
  create_loads: {
    label: 'Create loads',
    description: 'Add a load by hand from the board, and make test loads.',
    group: 'Loads',
  },
  edit_loads: {
    label: 'Edit loads',
    description: 'Change fields, stops, stage, flags and rates on a load.',
    group: 'Loads',
  },
  delete_loads: {
    label: 'Delete loads',
    description: 'Permanently remove a load and its history. Cancelling is the normal path.',
    group: 'Loads',
    sensitive: true,
  },
  import_carriers: {
    label: 'Import carriers',
    description: 'Bulk-add or update carriers from the CSV template.',
    group: 'Carriers',
  },
  export_carriers: {
    label: 'Export carriers',
    description: 'Download the whole carrier list as a file.',
    group: 'Carriers',
    sensitive: true,
  },
  import_customers: {
    label: 'Import customers',
    description: 'Bulk-add or update customers from the CSV template.',
    group: 'Customers',
  },
  export_customers: {
    label: 'Export customers',
    description: 'Download the whole customer list as a file.',
    group: 'Customers',
    sensitive: true,
  },
  view_reports: {
    label: 'View reports',
    description: 'See revenue, margin, run rate and runway.',
    group: 'Reports',
    sensitive: true,
  },
  manage_users: {
    label: 'Manage users',
    description: 'Change roles, teams, permissions and deactivate accounts.',
    group: 'Admin',
    sensitive: true,
  },
  manage_settings: {
    label: 'Manage settings',
    description: 'Edit flag cutoffs, QC bands and the reports inputs.',
    group: 'Admin',
    sensitive: true,
  },
}

export type RolePermissions = Partial<Record<Role, Partial<Record<PermissionKey, boolean>>>>

/**
 * Hard-coded fallback for the moment before org_settings has loaded. Matches
 * the seed in migration 20260101000007 — if you change one, change the other.
 */
export const FALLBACK_ROLE_PERMISSIONS: RolePermissions = {
  dispatcher: {
    create_loads: true,
    edit_loads: true,
    delete_loads: false,
    import_carriers: true,
    export_carriers: false,
    import_customers: true,
    export_customers: false,
    view_reports: false,
    manage_users: false,
    manage_settings: false,
  },
  viewer: {},
}

export function hasPermission(
  profile: Pick<Profile, 'role' | 'active' | 'permissions'> | null | undefined,
  key: PermissionKey,
  rolePermissions: RolePermissions | null | undefined = FALLBACK_ROLE_PERMISSIONS,
): boolean {
  if (!profile || !profile.active) return false
  if (profile.role === 'admin') return true

  const own = profile.permissions?.[key]
  if (typeof own === 'boolean') return own

  const roleDefault = rolePermissions?.[profile.role]?.[key]
  if (typeof roleDefault === 'boolean') return roleDefault

  return false
}

/** Every permission resolved for one user — what the Users page renders. */
export function resolvePermissions(
  profile: Pick<Profile, 'role' | 'active' | 'permissions'> | null | undefined,
  rolePermissions: RolePermissions | null | undefined,
): Record<PermissionKey, boolean> {
  const out = {} as Record<PermissionKey, boolean>
  for (const key of PERMISSION_KEYS) out[key] = hasPermission(profile, key, rolePermissions)
  return out
}

/**
 * Whether a user's setting for `key` is their own override or inherited from
 * the role — the Users page shows inherited toggles dimmer so an admin can
 * tell "this is the default" from "somebody set this on purpose".
 */
export function permissionSource(
  profile: Pick<Profile, 'role' | 'permissions'>,
  key: PermissionKey,
): 'admin' | 'override' | 'role' {
  if (profile.role === 'admin') return 'admin'
  if (typeof profile.permissions?.[key] === 'boolean') return 'override'
  return 'role'
}

export const ROLE_LABEL: Record<Role, string> = {
  admin: 'Admin',
  dispatcher: 'Dispatcher',
  viewer: 'Viewer',
}

export const ROLE_DESCRIPTION: Record<Role, string> = {
  admin: 'Everything, always. Cannot be restricted by permission toggles.',
  dispatcher: 'Works the board: creates and edits loads, carriers and customers.',
  viewer: 'Read-only. Sees the board and profiles, changes nothing.',
}

/** Suggested team keys. Free text is allowed; these just seed the picker. */
export const TEAM_SUGGESTIONS = [
  { key: 'dispatch', label: 'Dispatch' },
  { key: 'check_call', label: 'Check calls' },
  { key: 'sales', label: 'Sales' },
  { key: 'billing', label: 'Billing' },
]

export function teamLabel(key: string | null | undefined): string {
  if (!key) return 'No team'
  return TEAM_SUGGESTIONS.find((t) => t.key === key)?.label ?? key.replace(/_/g, ' ')
}
