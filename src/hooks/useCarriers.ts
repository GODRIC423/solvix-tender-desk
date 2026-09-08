import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { DEFAULT_INTERACTION_AGING, useSettings } from './useSettings'
import type { Carrier, CarrierInteractionView, InteractionAgeBucket } from '@/types/db'

/**
 * Carrier search. DOT number is the primary lookup key — every carrier has one
 * and it's unambiguous, unlike names ("R&R Trucking" vs "R and R Trucking").
 * A digits-only query is treated as a DOT/MC lookup first.
 */
export function useCarrierSearch(search: string) {
  return useQuery<Carrier[]>({
    queryKey: ['carriers', search],
    queryFn: async () => {
      let q = supabase.from('carriers').select('*')
      const term = search.trim()
      if (term) {
        const like = `%${term}%`
        q = q.or(
          [
            `dot_number.ilike.${like}`,
            `mc_number.ilike.${like}`,
            `name.ilike.${like}`,
            `scac.ilike.${like}`,
          ].join(','),
        )
      }
      const { data, error } = await q.order('name').limit(200)
      if (error) throw error
      return (data ?? []) as Carrier[]
    },
  })
}

export function useCarrier(carrierId: string | undefined) {
  return useQuery<Carrier>({
    queryKey: ['carrier', carrierId],
    enabled: Boolean(carrierId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('carriers')
        .select('*')
        .eq('id', carrierId)
        .single()
      if (error) throw error
      return data as Carrier
    },
  })
}

/**
 * Interactions for a carrier, bucketed by age:
 *   recent  — surfaced automatically when the carrier is opened
 *   caution — a caution badge on the interactions tab
 *   archive — everything older
 * This is what stops a dispatcher re-booking the truck whose turbo blew
 * on Tuesday.
 *
 * The view ships its own `age_bucket`, but with the 30-day / 1-year windows
 * hardcoded so it stays indexable. That would silently ignore the admin's
 * setting, so we re-bucket here against `org_settings.interaction_aging` —
 * otherwise the control in Settings would do nothing.
 */
export function useCarrierInteractions(carrierId: string | undefined) {
  const { data: settings } = useSettings()
  const aging = settings?.interactionAging ?? DEFAULT_INTERACTION_AGING

  return useQuery<CarrierInteractionView[]>({
    queryKey: ['carrier_interactions', carrierId, aging.recent_days, aging.caution_days],
    enabled: Boolean(carrierId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_carrier_recent_interactions')
        .select('*')
        .eq('carrier_id', carrierId)
        .order('created_at', { ascending: false })
        .limit(200)
      if (error) throw error

      const now = Date.now()
      const recentMs = aging.recent_days * 86_400_000
      const cautionMs = aging.caution_days * 86_400_000

      return ((data ?? []) as CarrierInteractionView[]).map((row) => {
        const age = now - new Date(row.created_at).getTime()
        const age_bucket: InteractionAgeBucket =
          age <= recentMs ? 'recent' : age <= cautionMs ? 'caution' : 'archive'
        return { ...row, age_bucket }
      })
    },
  })
}

export function useAddCarrierInteraction(carrierId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { interactionTypeId: string; body: string; loadId?: string }) => {
      const { error } = await supabase.from('carrier_interactions').insert({
        carrier_id: carrierId,
        interaction_type_id: input.interactionTypeId,
        body: input.body,
        load_id: input.loadId ?? null,
      })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['carrier_interactions', carrierId] })
    },
  })
}

export function useSaveCarrier() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (carrier: Partial<Carrier> & { name: string }) => {
      if (carrier.id) {
        const { error } = await supabase.from('carriers').update(carrier).eq('id', carrier.id)
        if (error) throw error
        return carrier.id
      }
      const { data, error } = await supabase.from('carriers').insert(carrier).select('id').single()
      if (error) throw error
      return (data as { id: string }).id
    },
    onSuccess: (id) => {
      qc.invalidateQueries({ queryKey: ['carriers'] })
      qc.invalidateQueries({ queryKey: ['carrier', id] })
    },
  })
}

/** Loads this carrier has hauled — the beginnings of their performance record. */
export function useCarrierLoads(carrierId: string | undefined) {
  return useQuery({
    queryKey: ['carrier_loads', carrierId],
    enabled: Boolean(carrierId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_load_board')
        .select('*')
        .eq('carrier_id', carrierId)
        .order('first_pickup_at', { ascending: false })
        .limit(100)
      if (error) throw error
      return data ?? []
    },
  })
}
