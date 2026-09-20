import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { LoadStatusHistory } from '@/types/db'

/**
 * Every stage change on a set of loads — the "what actually happened" half
 * of a carrier's or customer's history. The loads themselves are already
 * fetched for the record's Loads tab, so this just asks for their trail.
 */
export function useStageEventsForLoads(loadIds: string[]) {
  const key = [...loadIds].sort().join(',')
  return useQuery<LoadStatusHistory[]>({
    queryKey: ['stage_events', key],
    enabled: loadIds.length > 0,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('load_status_history')
        .select('*')
        .in('load_id', loadIds)
        .order('changed_at', { ascending: false })
        .limit(400)
      if (error) throw error
      return (data ?? []) as LoadStatusHistory[]
    },
  })
}
