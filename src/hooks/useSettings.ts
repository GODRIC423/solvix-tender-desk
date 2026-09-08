import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { DEFAULT_QC_BANDS, type QcBandThresholds } from '@/lib/qc-bands'
import { DEFAULT_URGENCY_RULES, type UrgencyRules } from '@/lib/urgency'
import type { FlagType, InteractionType, PipelineStage } from '@/types/db'

export interface InteractionAging {
  recent_days: number
  caution_days: number
}

export const DEFAULT_INTERACTION_AGING: InteractionAging = {
  recent_days: 30,
  caution_days: 365,
}

export interface ResolvedSettings {
  qcBands: QcBandThresholds
  urgencyRules: UrgencyRules
  interactionAging: InteractionAging
}

/**
 * Org settings drive every threshold in the UI (QC bands, urgency cutoffs,
 * note aging). If the table can't be read we fall back to defaults rather than
 * blanking the board — a dispatcher with slightly-off colors beats no board.
 */
export function useSettings() {
  return useQuery<ResolvedSettings>({
    queryKey: ['org_settings'],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('org_settings')
        .select('qc_bands, urgency_rules, interaction_aging')
        .eq('id', 1)
        .maybeSingle()

      if (error || !data) {
        return {
          qcBands: DEFAULT_QC_BANDS,
          urgencyRules: DEFAULT_URGENCY_RULES,
          interactionAging: DEFAULT_INTERACTION_AGING,
        }
      }

      return {
        qcBands: { ...DEFAULT_QC_BANDS, ...((data.qc_bands as object) ?? {}) },
        urgencyRules: {
          unbooked: {
            ...DEFAULT_URGENCY_RULES.unbooked,
            ...(((data.urgency_rules as any)?.unbooked as object) ?? {}),
          },
          booked: {
            ...DEFAULT_URGENCY_RULES.booked,
            ...(((data.urgency_rules as any)?.booked as object) ?? {}),
          },
        },
        interactionAging: {
          ...DEFAULT_INTERACTION_AGING,
          ...((data.interaction_aging as object) ?? {}),
        },
      }
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
