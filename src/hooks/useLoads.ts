import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type {
  Load,
  LoadBoardRow,
  LoadCharge,
  LoadFlag,
  LoadParty,
  LoadReference,
  LoadStop,
  LoadStatusHistory,
  LoadTrackingEvent,
} from '@/types/db'

export interface LoadBoardFilters {
  stageKeys?: string[]
  search?: string
  /** Hide delivered/paid/cancelled unless explicitly asked for. */
  includeTerminal?: boolean
}

export function useLoadBoard(filters: LoadBoardFilters = {}) {
  const qc = useQueryClient()

  // Keep the board live across dispatchers: any write to loads or the tables
  // that feed the urgency color invalidates the board query.
  useEffect(() => {
    const channel = supabase
      .channel('load-board')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'loads' }, () => {
        qc.invalidateQueries({ queryKey: ['load_board'] })
      })
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'load_tracking_events' },
        () => {
          qc.invalidateQueries({ queryKey: ['load_board'] })
        },
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'load_flags' }, () => {
        qc.invalidateQueries({ queryKey: ['load_board'] })
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [qc])

  return useQuery<LoadBoardRow[]>({
    queryKey: ['load_board', filters],
    queryFn: async () => {
      let q = supabase.from('v_load_board').select('*')

      if (filters.stageKeys?.length) q = q.in('stage_key', filters.stageKeys)
      if (!filters.includeTerminal && !filters.stageKeys?.length) {
        q = q.eq('stage_is_terminal', false)
      }
      if (filters.search?.trim()) {
        const term = `%${filters.search.trim()}%`
        q = q.or(
          [
            `load_number.ilike.${term}`,
            `shipment_id.ilike.${term}`,
            `customer_name.ilike.${term}`,
            `carrier_name.ilike.${term}`,
            `carrier_dot_number.ilike.${term}`,
            `origin_city.ilike.${term}`,
            `dest_city.ilike.${term}`,
            `commodity.ilike.${term}`,
          ].join(','),
        )
      }

      // Soonest pickup first — that's the order a dispatcher works the board in.
      const { data, error } = await q
        .order('first_pickup_at', { ascending: true, nullsFirst: false })
        .limit(500)
      if (error) throw error
      return (data ?? []) as LoadBoardRow[]
    },
  })
}

export interface LoadDetail {
  load: Load
  stops: LoadStop[]
  parties: LoadParty[]
  charges: LoadCharge[]
  references: LoadReference[]
  flags: LoadFlag[]
  tracking: LoadTrackingEvent[]
  history: LoadStatusHistory[]
}

export function useLoad(loadId: string | undefined) {
  return useQuery<LoadDetail>({
    queryKey: ['load', loadId],
    enabled: Boolean(loadId),
    queryFn: async () => {
      const [load, stops, parties, charges, references, flags, tracking, history] =
        await Promise.all([
          supabase.from('loads').select('*').eq('id', loadId).single(),
          supabase.from('load_stops').select('*').eq('load_id', loadId).order('sequence'),
          supabase.from('load_parties').select('*').eq('load_id', loadId),
          supabase.from('load_charges').select('*').eq('load_id', loadId),
          supabase.from('load_references').select('*').eq('load_id', loadId),
          supabase
            .from('load_flags')
            .select('*')
            .eq('load_id', loadId)
            .is('resolved_at', null)
            .order('created_at', { ascending: false }),
          supabase
            .from('load_tracking_events')
            .select('*')
            .eq('load_id', loadId)
            .order('created_at', { ascending: false }),
          supabase
            .from('load_status_history')
            .select('*')
            .eq('load_id', loadId)
            .order('changed_at', { ascending: false }),
        ])

      if (load.error) throw load.error

      return {
        load: load.data as Load,
        stops: (stops.data ?? []) as LoadStop[],
        parties: (parties.data ?? []) as LoadParty[],
        charges: (charges.data ?? []) as LoadCharge[],
        references: (references.data ?? []) as LoadReference[],
        flags: (flags.data ?? []) as LoadFlag[],
        tracking: (tracking.data ?? []) as LoadTrackingEvent[],
        history: (history.data ?? []) as LoadStatusHistory[],
      }
    },
  })
}

/**
 * Update fields on a load. Every change is also written to `load_field_edits`
 * so the QC trail is durable — the legacy app kept this only in memory, and it
 * is what will later feed "what did you pick last time for this customer".
 */
export function useUpdateLoad(loadId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      patch,
      previous,
    }: {
      patch: Record<string, unknown>
      previous?: Record<string, unknown>
    }) => {
      const { error } = await supabase
        .from('loads')
        .update({ ...patch, last_touched_at: new Date().toISOString() })
        .eq('id', loadId)
      if (error) throw error

      const edits = Object.entries(patch).map(([field_key, new_value]) => ({
        load_id: loadId,
        field_key,
        old_value: previous?.[field_key] == null ? null : String(previous[field_key]),
        new_value: new_value == null ? null : String(new_value),
      }))
      if (edits.length) {
        // A failed audit insert shouldn't roll back the user's edit, but we do
        // want to know about it.
        const { error: auditError } = await supabase.from('load_field_edits').insert(edits)
        if (auditError) console.error('[solvix] failed to record field edit', auditError)
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['load', loadId] })
      qc.invalidateQueries({ queryKey: ['load_board'] })
    },
  })
}

export function useSetLoadStage(loadId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ stageId, note }: { stageId: string; note?: string }) => {
      // A DB trigger writes load_status_history and stamps the per-stage
      // timestamp, so the client only sets the stage.
      const { error } = await supabase
        .from('loads')
        .update({ pipeline_stage_id: stageId, last_touched_at: new Date().toISOString() })
        .eq('id', loadId)
      if (error) throw error
      if (note?.trim()) {
        await supabase.from('load_tracking_events').insert({
          load_id: loadId,
          type: 'status_update',
          note: note.trim(),
        })
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['load', loadId] })
      qc.invalidateQueries({ queryKey: ['load_board'] })
    },
  })
}

export function useAddTrackingEvent(loadId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (event: {
      type: LoadTrackingEvent['type']
      note?: string
      location?: string
    }) => {
      const { error } = await supabase.from('load_tracking_events').insert({
        load_id: loadId,
        type: event.type,
        note: event.note ?? null,
        location: event.location ?? null,
      })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['load', loadId] })
      qc.invalidateQueries({ queryKey: ['load_board'] })
    },
  })
}

export function useLoadFlags(loadId: string) {
  const qc = useQueryClient()
  const add = useMutation({
    mutationFn: async ({ flagTypeId, note }: { flagTypeId: string; note?: string }) => {
      const { error } = await supabase
        .from('load_flags')
        .insert({ load_id: loadId, flag_type_id: flagTypeId, note: note ?? null })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['load', loadId] })
      qc.invalidateQueries({ queryKey: ['load_board'] })
    },
  })

  const resolve = useMutation({
    mutationFn: async (flagId: string) => {
      const { error } = await supabase
        .from('load_flags')
        .update({ resolved_at: new Date().toISOString() })
        .eq('id', flagId)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['load', loadId] })
      qc.invalidateQueries({ queryKey: ['load_board'] })
    },
  })

  return { add, resolve }
}

export function useUpdateStop(loadId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ stopId, patch }: { stopId: string; patch: Record<string, unknown> }) => {
      const { error } = await supabase.from('load_stops').update(patch).eq('id', stopId)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['load', loadId] })
      qc.invalidateQueries({ queryKey: ['load_board'] })
    },
  })
}
