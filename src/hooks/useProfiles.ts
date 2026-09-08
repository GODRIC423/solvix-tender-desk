import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Profile, Role, ViewPrefs } from '@/types/db'
import { useAuth } from './useAuth'

/** Every profile, for the Users page. RLS already limits this to active members. */
export function useProfiles() {
  return useQuery<Profile[]>({
    queryKey: ['profiles'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .order('active', { ascending: false })
        .order('full_name')
      if (error) throw error
      return (data ?? []).map((p) => ({
        ...(p as Profile),
        permissions: ((p as Profile).permissions ?? {}) as Record<string, boolean>,
        preferences: ((p as Profile).preferences ?? {}) as ViewPrefs,
      }))
    },
  })
}

export interface ProfilePatch {
  full_name?: string | null
  role?: Role
  active?: boolean
  team?: string | null
  permissions?: Record<string, boolean>
  preferences?: ViewPrefs
}

/**
 * Admin edits to another user. role/active/team/permissions are guarded by a
 * database trigger, so a non-admin calling this gets a 42501 back — the UI
 * only shows the page to admins, but the trigger is what enforces it.
 */
export function useUpdateProfile() {
  const qc = useQueryClient()
  const { profile: me, refreshProfile } = useAuth()
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: ProfilePatch }) => {
      const { error } = await supabase.from('profiles').update(patch).eq('id', id)
      if (error) throw error
      return id
    },
    onSuccess: async (id) => {
      qc.invalidateQueries({ queryKey: ['profiles'] })
      if (id === me?.id) await refreshProfile()
    },
  })
}

/**
 * A user's own board preferences. Anyone may edit their own row; the guard
 * trigger only protects the privileged columns.
 */
export function useSaveMyPreferences() {
  const { profile, refreshProfile } = useAuth()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (preferences: ViewPrefs) => {
      if (!profile) throw new Error('Not signed in')
      const { error } = await supabase.from('profiles').update({ preferences }).eq('id', profile.id)
      if (error) throw error
    },
    onSuccess: async () => {
      await refreshProfile()
      qc.invalidateQueries({ queryKey: ['profiles'] })
    },
  })
}
