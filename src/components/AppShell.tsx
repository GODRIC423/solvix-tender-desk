import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { teamLabel } from '@/lib/permissions'

export default function AppShell() {
  const { profile, signOut, can } = useAuth()

  const nav = [
    { to: '/loads', label: 'Loads' },
    { to: '/carriers', label: 'Carriers' },
    { to: '/customers', label: 'Customers' },
    ...(can('view_reports') ? [{ to: '/reports', label: 'Reports' }] : []),
    ...(can('manage_users') ? [{ to: '/users', label: 'Users' }] : []),
    { to: '/settings', label: 'Settings' },
  ]

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-20 border-b border-ink-700 bg-ink-900/95 backdrop-blur">
        <div className="flex items-center gap-6 px-4 py-2.5">
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-semibold tracking-tight text-slate-100">
              Solvix Tender Desk
            </span>
          </div>

          <nav className="flex items-center gap-1">
            {nav.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/loads'}
                className={({ isActive }) =>
                  `rounded-md px-3 py-1.5 text-sm font-medium transition ${
                    isActive
                      ? 'bg-accent/15 text-accent'
                      : 'text-slate-300 hover:bg-ink-800 hover:text-slate-100'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            <a
              href="/connector/"
              target="_blank"
              rel="noreferrer"
              className="btn text-xs"
              title="Open the standalone tender drop tool"
            >
              Drop a tender ↗
            </a>
            <span className="text-xs text-slate-400" title={profile?.team ? teamLabel(profile.team) : undefined}>
              {profile?.full_name ?? profile?.email ?? 'Signed in'}
              {profile?.role ? ` · ${profile.role}` : ''}
              {profile?.team ? ` · ${teamLabel(profile.team)}` : ''}
            </span>
            <button className="btn text-xs" onClick={() => void signOut()}>
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  )
}
