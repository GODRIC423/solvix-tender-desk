import { useMemo, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { useProfiles, useUpdateProfile } from '@/hooks/useProfiles'
import { useSaveSettings, useSettings } from '@/hooks/useSettings'
import {
  PERMISSIONS,
  PERMISSION_KEYS,
  ROLE_DESCRIPTION,
  ROLE_LABEL,
  TEAM_SUGGESTIONS,
  hasPermission,
  permissionSource,
  type PermissionKey,
  type RolePermissions,
} from '@/lib/permissions'
import { resolveViewPrefs } from '@/lib/view-prefs'
import Toggle, { ToggleRow } from '@/components/Toggle'
import type { Profile, Role, ViewPrefs } from '@/types/db'

/**
 * Users: roles, teams, permissions, and per-person board view.
 *
 * Two layers of switches. "Role defaults" at the bottom set what a dispatcher
 * or viewer can do out of the box; the per-user panel overrides any of them
 * for one person. An inherited switch renders dimmer than one somebody set on
 * purpose, and can be reset back to inheriting.
 *
 * Only what is shown here is UI. The database trigger on profiles refuses
 * role/active/team/permissions changes from anyone but an admin, and the bulk
 * import and load-creation RPCs check has_permission() themselves — so a
 * switch here is a real gate, not a hidden button.
 */
export default function Users() {
  const { can, profile: me } = useAuth()
  const { data: settings } = useSettings()
  const { data: profiles, isLoading, error } = useProfiles()
  const [openId, setOpenId] = useState<string | null>(null)

  if (!can('manage_users')) {
    return (
      <div className="p-6">
        <div className="card border-band-yellow/40 bg-band-yellow/10 p-3 text-sm text-amber-200">
          Only an admin can manage users.
        </div>
      </div>
    )
  }

  return (
    <div className="p-4">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold text-slate-100">Users</h1>
        <span className="text-xs text-slate-500">
          New accounts are created in Supabase (Authentication → Users) and appear here on their
          own.
        </span>
      </div>

      {error && (
        <div className="card mb-3 border-band-red/40 bg-band-red/10 p-3 text-sm text-red-300">
          {(error as Error).message}
        </div>
      )}

      <div className="card overflow-hidden">
        <table className="w-full border-collapse">
          <thead className="border-b border-ink-700 bg-ink-850">
            <tr>
              <th className="th">User</th>
              <th className="th">Role</th>
              <th className="th">Team</th>
              <th className="th">Active</th>
              <th className="th" />
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td className="td text-slate-400" colSpan={5}>
                  Loading…
                </td>
              </tr>
            )}
            {(profiles ?? []).map((p) => (
              <UserRow
                key={p.id}
                profile={p}
                isMe={p.id === me?.id}
                open={openId === p.id}
                onToggleOpen={() => setOpenId(openId === p.id ? null : p.id)}
                rolePermissions={settings?.rolePermissions}
                teamDefaults={settings?.teamDefaults ?? {}}
              />
            ))}
          </tbody>
        </table>
      </div>

      <RoleDefaults rolePermissions={settings?.rolePermissions} />
    </div>
  )
}

function UserRow({
  profile,
  isMe,
  open,
  onToggleOpen,
  rolePermissions,
  teamDefaults,
}: {
  profile: Profile
  isMe: boolean
  open: boolean
  onToggleOpen: () => void
  rolePermissions: RolePermissions | undefined
  teamDefaults: Record<string, ViewPrefs>
}) {
  const update = useUpdateProfile()
  const patch = (p: Parameters<typeof update.mutate>[0]['patch']) =>
    update.mutate({ id: profile.id, patch: p })

  return (
    <>
      <tr className={`border-b border-ink-800 ${open ? 'bg-ink-850' : 'hover:bg-ink-850'}`}>
        <td className="td">
          <div className="font-medium text-slate-100">
            {profile.full_name ?? profile.email ?? profile.id.slice(0, 8)}
            {isMe && <span className="ml-2 text-xs text-slate-500">(you)</span>}
          </div>
          <div className="text-xs text-slate-500">{profile.email}</div>
        </td>
        <td className="td">
          <select
            className="input w-36"
            value={profile.role}
            disabled={isMe}
            title={isMe ? "You can't change your own role" : ROLE_DESCRIPTION[profile.role]}
            onChange={(e) => patch({ role: e.target.value as Role })}
          >
            {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        </td>
        <td className="td">
          <input
            className="input w-36"
            list="team-suggestions"
            placeholder="none"
            defaultValue={profile.team ?? ''}
            onBlur={(e) => {
              const v = e.target.value.trim().toLowerCase().replace(/\s+/g, '_') || null
              if (v !== profile.team) patch({ team: v })
            }}
          />
          <datalist id="team-suggestions">
            {TEAM_SUGGESTIONS.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </datalist>
        </td>
        <td className="td">
          <Toggle
            checked={profile.active}
            disabled={isMe}
            onChange={(v) => patch({ active: v })}
            size="sm"
          />
        </td>
        <td className="td text-right">
          <button className="btn text-xs" onClick={onToggleOpen}>
            {open ? 'Close' : 'Permissions & view'}
          </button>
        </td>
      </tr>
      {open && (
        <tr className="border-b border-ink-800 bg-ink-900">
          <td colSpan={5} className="p-3">
            {update.error && (
              <div className="mb-2 text-xs text-red-300">{(update.error as Error).message}</div>
            )}
            <div className="grid gap-4 lg:grid-cols-2">
              <UserPermissions profile={profile} rolePermissions={rolePermissions} onPatch={patch} />
              <UserView profile={profile} teamDefaults={teamDefaults} onPatch={patch} />
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

function UserPermissions({
  profile,
  rolePermissions,
  onPatch,
}: {
  profile: Profile
  rolePermissions: RolePermissions | undefined
  onPatch: (p: { permissions: Record<string, boolean> }) => void
}) {
  const groups = useMemo(() => {
    const byGroup = new Map<string, PermissionKey[]>()
    for (const k of PERMISSION_KEYS) {
      const g = PERMISSIONS[k].group
      byGroup.set(g, [...(byGroup.get(g) ?? []), k])
    }
    return [...byGroup.entries()]
  }, [])

  if (profile.role === 'admin') {
    return (
      <section>
        <h3 className="mb-1 text-sm font-semibold text-slate-200">Permissions</h3>
        <p className="text-xs text-slate-500">
          Admins have every permission and can&apos;t be restricted. Change the role to limit
          what this person can do.
        </p>
      </section>
    )
  }

  function set(key: PermissionKey, value: boolean | null) {
    const next = { ...profile.permissions }
    if (value === null) delete next[key]
    else next[key] = value
    onPatch({ permissions: next })
  }

  return (
    <section>
      <h3 className="mb-1 text-sm font-semibold text-slate-200">Permissions</h3>
      <p className="mb-2 text-xs text-slate-500">
        Dimmed switches are inherited from the {ROLE_LABEL[profile.role].toLowerCase()} role
        defaults. Flip one to set it for this person only.
      </p>
      {groups.map(([group, keys]) => (
        <div key={group} className="mb-2">
          <div className="label">{group}</div>
          <div className="divide-y divide-ink-800">
            {keys.map((k) => {
              const src = permissionSource(profile, k)
              const on = hasPermission(profile, k, rolePermissions)
              const meta = PERMISSIONS[k]
              return (
                <ToggleRow
                  key={k}
                  label={
                    <span className="inline-flex items-center gap-2">
                      {meta.label}
                      {meta.sensitive && (
                        <span
                          className="rounded bg-band-yellow/15 px-1 text-[10px] uppercase text-amber-300"
                          title="Lets data leave the system or changes who can do what"
                        >
                          sensitive
                        </span>
                      )}
                    </span>
                  }
                  description={meta.description}
                  checked={on}
                  inherited={src === 'role'}
                  tone={meta.sensitive ? 'amber' : 'green'}
                  onChange={(v) => set(k, v)}
                >
                  {src === 'override' && (
                    <button
                      className="text-[11px] text-slate-500 underline hover:text-slate-300"
                      onClick={() => set(k, null)}
                      title="Go back to the role default"
                    >
                      reset
                    </button>
                  )}
                </ToggleRow>
              )
            })}
          </div>
        </div>
      ))}
    </section>
  )
}

function UserView({
  profile,
  teamDefaults,
  onPatch,
}: {
  profile: Profile
  teamDefaults: Record<string, ViewPrefs>
  onPatch: (p: { preferences: ViewPrefs }) => void
}) {
  const teamPrefs = profile.team ? teamDefaults[profile.team] : undefined
  const resolved = resolveViewPrefs(teamPrefs, profile.preferences)
  const own = profile.preferences ?? {}

  const setPref = (next: ViewPrefs) => onPatch({ preferences: next })

  return (
    <section>
      <h3 className="mb-1 text-sm font-semibold text-slate-200">Board view</h3>
      <p className="mb-2 text-xs text-slate-500">
        What this person sees on the load board. Dimmed switches follow their team
        {profile.team ? ` (${profile.team.replace(/_/g, ' ')})` : ' — none set, so the org default'}.
      </p>
      <div className="divide-y divide-ink-800">
        <ToggleRow
          label="Unbooked loads"
          description="Show loads with no carrier, and their flags"
          checked={resolved.show_unbooked}
          inherited={own.show_unbooked === undefined}
          onChange={(v) =>
            setPref({
              ...own,
              show_unbooked: v,
              flags: { ...own.flags, unbooked: { ...own.flags?.unbooked, enabled: v } },
            })
          }
        />
        <ToggleRow
          label="Booked loads"
          description="Show loads with a carrier, and their flags"
          checked={resolved.show_booked}
          inherited={own.show_booked === undefined}
          onChange={(v) =>
            setPref({
              ...own,
              show_booked: v,
              flags: { ...own.flags, booked: { ...own.flags?.booked, enabled: v } },
            })
          }
        />
        <ToggleRow
          label="Yellow flags"
          description="The gentlest tier, on both boards"
          checked={resolved.flags.unbooked.yellow && resolved.flags.booked.stale}
          inherited={own.flags?.unbooked?.yellow === undefined && own.flags?.booked?.stale === undefined}
          onChange={(v) =>
            setPref({
              ...own,
              flags: {
                unbooked: { ...own.flags?.unbooked, yellow: v },
                booked: { ...own.flags?.booked, stale: v },
              },
            })
          }
        />
      </div>
      {Object.keys(own).length > 0 && (
        <button
          className="mt-2 text-[11px] text-slate-500 underline hover:text-slate-300"
          onClick={() => setPref({})}
        >
          Reset to team default
        </button>
      )}
    </section>
  )
}

/** Org-wide defaults per role. Admin is implicit and not editable. */
function RoleDefaults({ rolePermissions }: { rolePermissions: RolePermissions | undefined }) {
  const save = useSaveSettings()
  const roles: Role[] = ['dispatcher', 'viewer']

  function set(role: Role, key: PermissionKey, value: boolean) {
    const next: RolePermissions = {
      ...rolePermissions,
      [role]: { ...rolePermissions?.[role], [key]: value },
    }
    save.mutate({ role_permissions: next })
  }

  return (
    <section className="card mt-4 p-3">
      <h2 className="mb-1 text-sm font-semibold text-slate-200">Role defaults</h2>
      <p className="mb-3 text-xs text-slate-500">
        What each role can do unless a person is given their own setting above. Admins always
        have everything.
      </p>
      {save.error && (
        <div className="mb-2 text-xs text-red-300">{(save.error as Error).message}</div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-ink-700">
              <th className="th">Permission</th>
              {roles.map((r) => (
                <th key={r} className="th text-center">
                  {ROLE_LABEL[r]}
                  <div className="text-[10px] font-normal normal-case tracking-normal text-slate-500">
                    {ROLE_DESCRIPTION[r]}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PERMISSION_KEYS.map((k) => (
              <tr key={k} className="border-b border-ink-800">
                <td className="td">
                  <div className="text-slate-200">{PERMISSIONS[k].label}</div>
                  <div className="text-xs text-slate-500">{PERMISSIONS[k].description}</div>
                </td>
                {roles.map((r) => (
                  <td key={r} className="td text-center">
                    <Toggle
                      checked={rolePermissions?.[r]?.[k] === true}
                      onChange={(v) => set(r, k, v)}
                      tone={PERMISSIONS[k].sensitive ? 'amber' : 'green'}
                      size="sm"
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
