import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { hasPermission, type PermissionKey } from '@/lib/permissions'
import { applyViewPrefs, resolveViewPrefs, type ResolvedViewPrefs } from '@/lib/view-prefs'
import { DEFAULT_FLAG_RULES, type FlagRules } from '@/lib/urgency'
import type { Profile } from '@/types/db'
import { useSettings } from './useSettings'

interface AuthState {
  session: Session | null
  profile: Profile | null
  loading: boolean
  isAdmin: boolean
  /** Permission check that mirrors has_permission() in the database. */
  can: (key: PermissionKey) => boolean
  /** Board view for this user: org -> team -> own preferences. */
  view: ResolvedViewPrefs
  /** The org's flag cutoffs narrowed by this user's view. */
  flagRules: FlagRules
  refreshProfile: () => Promise<void>
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const { data: settings } = useSettings()

  useEffect(() => {
    let cancelled = false

    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return
      setSession(data.session)
      setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
    })

    return () => {
      cancelled = true
      sub.subscription.unsubscribe()
    }
  }, [])

  const userId = session?.user?.id

  async function loadProfile(id: string | undefined) {
    if (!id) {
      setProfile(null)
      return
    }
    const { data } = await supabase.from('profiles').select('*').eq('id', id).maybeSingle()
    setProfile(normalizeProfile(data as Profile | null))
  }

  useEffect(() => {
    let cancelled = false
    if (!userId) {
      setProfile(null)
      return
    }
    supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setProfile(normalizeProfile(data as Profile | null))
      })
    return () => {
      cancelled = true
    }
  }, [userId])

  const view = useMemo(
    () => resolveViewPrefs(profile?.team ? settings?.teamDefaults?.[profile.team] : undefined, profile?.preferences),
    [profile?.team, profile?.preferences, settings?.teamDefaults],
  )

  const flagRules = useMemo(
    () => applyViewPrefs(settings?.flagRules ?? DEFAULT_FLAG_RULES, view),
    [settings?.flagRules, view],
  )

  const value: AuthState = {
    session,
    profile,
    loading,
    isAdmin: profile?.role === 'admin' && profile.active,
    can: (key) => hasPermission(profile, key, settings?.rolePermissions),
    view,
    flagRules,
    refreshProfile: () => loadProfile(userId),
    async signIn(email, password) {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      return { error: error?.message ?? null }
    },
    async signOut() {
      await supabase.auth.signOut()
    },
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

/** Rows from before migration 7 lack the JSON columns; give them safe shapes. */
function normalizeProfile(p: Profile | null): Profile | null {
  if (!p) return null
  return {
    ...p,
    team: p.team ?? null,
    permissions: (p.permissions && typeof p.permissions === 'object' ? p.permissions : {}) as Record<
      string,
      boolean
    >,
    preferences: (p.preferences && typeof p.preferences === 'object' ? p.preferences : {}) as Profile['preferences'],
  }
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
