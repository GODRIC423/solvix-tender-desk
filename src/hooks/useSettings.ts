import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { DEFAULT_QC_BANDS, type QcBandThresholds } from '@/lib/qc-bands'
import {
  DEFAULT_FLAG_RULES,
  fromLegacyUrgencyRules,
  normalizeFlagRules,
  type FlagRules,
} from '@/lib/urgency'
import { FALLBACK_ROLE_PERMISSIONS, type RolePermissions } from '@/lib/permissions'
import type {
  CustomerInteractionType,
  FlagType,
  InteractionType,
  PipelineStage,
  ViewPrefs,
} from '@/types/db'

export interface InteractionAging {
  recent_days: number
  caution_days: number
}

export const DEFAULT_INTERACTION_AGING: InteractionAging = {
  recent_days: 30,
  caution_days: 365,
}

export interface Financials {
  cash_on_hand: number | null
  monthly_overhead: number | null
}

export interface ResolvedSettings {
  qcBands: QcBandThresholds
  flagRules: FlagRules
  interactionAging: InteractionAging
  teamDefaults: Record<string, ViewPrefs>
  rolePermissions: RolePermissions
  financials: Financials
  defaultTimezone: string
}

const DEFAULTS: ResolvedSettings = {
  qcBands: DEFAULT_QC_BANDS,
  flagRules: DEFAULT_FLAG_RULES,
  interactionAging: DEFAULT_INTERACTION_AGING,
  teamDefaults: {},
  rolePermissions: FALLBACK_ROLE_PERMISSIONS,
  financials: { cash_on_hand: null, monthly_overhead: null },
  defaultTimezone: 'America/Chicago',
}

/**
 * Org settings drive every threshold in the UI (QC bands, flag cutoffs, note
 * aging), plus who-sees-what and the reports inputs. If the table can't be
 * read we fall back to defaults rather than blanking the board — a dispatcher
 * with slightly-off colours beats no board.
 */
export function useSettings() {
  return useQuery<ResolvedSettings>({
    queryKey: ['org_settings'],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('org_settings')
        .select(
          'qc_bands, urgency_rules, flag_rules, interaction_aging, team_defaults, role_permissions, cash_on_hand, monthly_overhead, default_timezone',
        )
        .eq('id', 1)
        .maybeSingle()

      if (error || !data) return DEFAULTS

      const row = data as Record<string, unknown>

      // A row migrated by 20260101000007 has flag_rules populated. One that
      // predates it (or was reset) only has urgency_rules — carry it across so
      // tuned cutoffs survive the upgrade.
      const flagRules =
        row.flag_rules && Object.keys(row.flag_rules as object).length > 0
          ? normalizeFlagRules(row.flag_rules)
          : fromLegacyUrgencyRules(row.urgency_rules as never)

      const rolePermissions =
        row.role_permissions && Object.keys(row.role_permissions as object).length > 0
          ? (row.role_permissions as RolePermissions)
          : FALLBACK_ROLE_PERMISSIONS

      return {
        qcBands: { ...DEFAULT_QC_BANDS, ...((row.qc_bands as object) ?? {}) },
        flagRules,
        interactionAging: {
          ...DEFAULT_INTERACTION_AGING,
          ...((row.interaction_aging as object) ?? {}),
        },
        teamDefaults: (row.team_defaults as Record<string, ViewPrefs>) ?? {},
        rolePermissions,
        financials: {
          cash_on_hand: numberOrNull(row.cash_on_hand),
          monthly_overhead: numberOrNull(row.monthly_overhead),
        },
        defaultTimezone: (row.default_timezone as string) || DEFAULTS.defaultTimezone,
      }
    },
  })
}

function numberOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export interface SettingsPatch {
  qc_bands?: QcBandThresholds
  flag_rules?: FlagRules
  interaction_aging?: InteractionAging
  team_defaults?: Record<string, ViewPrefs>
  role_permissions?: RolePermissions
  cash_on_hand?: number | null
  monthly_overhead?: number | null
}

export function useSaveSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (patch: SettingsPatch) => {
      const { error } = await supabase.from('org_settings').update(patch).eq('id', 1)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['org_settings'] })
    },
  })
}

export function usePipelineStages() {
  return useQuery<PipelineStage[]>({
    queryKey: ['pipeline_stages'],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pipeline_stages')
        .select('*')
        .eq('active', true)
        .order('sort_order')
      if (error) throw error
      return (data ?? []) as PipelineStage[]
    },
  })
}

export function useFlagTypes() {
  return useQuery<FlagType[]>({
    queryKey: ['flag_types'],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('flag_types')
        .select('*')
        .eq('active', true)
        .order('sort_order')
      if (error) throw error
      return (data ?? []) as FlagType[]
    },
  })
}

export function useInteractionTypes() {
  return useQuery<InteractionType[]>({
    queryKey: ['interaction_types'],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('interaction_types')
        .select('*')
        .eq('active', true)
        .order('sort_order')
      if (error) throw error
      return (data ?? []) as InteractionType[]
    },
  })
}

export function useCustomerInteractionTypes() {
  return useQuery<CustomerInteractionType[]>({
    queryKey: ['customer_interaction_types'],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('customer_interaction_types')
        .select('*')
        .eq('active', true)
        .order('sort_order')
      if (error) throw error
      return (data ?? []) as CustomerInteractionType[]
    },
  })
}
