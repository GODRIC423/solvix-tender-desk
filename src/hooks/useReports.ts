import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { DateRange } from '@/lib/reports'
import type { ReportLoad } from '@/types/db'

/**
 * Every non-test load that could fall in the range. Pulled by BOTH pickup
 * and created date with a one-week margin, then bucketed exactly in
 * `summarize()` — the view can't know which date a load will be counted by.
 */
export function useReportLoads(range: DateRange) {
  return useQuery<ReportLoad[]>({
    queryKey: ['report_loads', range.from, range.to],
    staleTime: 60_000,
    queryFn: async () => {
      const pad = 7 * 86_400_000
      const from = new Date(new Date(range.from).getTime() - pad).toISOString()
      const to = new Date(new Date(range.to).getTime() + pad).toISOString()
      const { data, error } = await supabase
        .from('v_report_loads')
        .select('*')
        .or(
          `and(first_pickup_at.gte.${from},first_pickup_at.lt.${to}),and(first_pickup_at.is.null,created_at.gte.${from},created_at.lt.${to})`,
        )
        .order('first_pickup_at', { ascending: true, nullsFirst: false })
        .limit(5000)
      if (error) throw error
      return (data ?? []) as ReportLoad[]
    },
  })
}
