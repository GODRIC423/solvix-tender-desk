import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Carrier } from '@/types/db'

/**
 * Row shape of `v_carrier_performance`.
 *
 * The on-time percentages are `null` — never 0 — until an actual arrival has
 * been logged against a stop, so anything consuming them has to tell "we have
 * never measured this carrier" apart from "this carrier is never on time".
 * The `*_rated_count` columns say how many loads each percentage stands on.
 */
export interface CarrierPerformanceRow {
  carrier_id: string
  carrier_name: string
  dot_number: string | null
  status: Carrier['status']

  loads_total: number
  loads_delivered: number
  last_delivered_at: string | null

  pickup_rated_count: number
  on_time_pickup_pct: number | null
  delivery_rated_count: number
  on_time_delivery_pct: number | null

  avg_rate_per_mile: number | null
  avg_rate_per_mile_eastbound: number | null
  avg_rate_per_mile_westbound: number | null
  eastbound_loads: number
  westbound_loads: number

  quick_pay_requests: number
  rate_increase_requests: number
  service_failures: number
  fell_off_loads: number
  last_interaction_at: string | null
}

/**
 * The scorecard for one carrier. The view left-joins from `carriers`, so a
 * carrier with no history still returns a row (zeroed counts, null averages)
 * rather than nothing — `null` here means the carrier id itself is unknown.
 */
export function useCarrierPerformance(carrierId: string | undefined) {
  return useQuery<CarrierPerformanceRow | null>({
    queryKey: ['carrier_performance', carrierId],
    enabled: Boolean(carrierId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_carrier_performance')
        .select('*')
        .eq('carrier_id', carrierId)
        .maybeSingle()
      if (error) throw error
      return (data as CarrierPerformanceRow | null) ?? null
    },
  })
}
