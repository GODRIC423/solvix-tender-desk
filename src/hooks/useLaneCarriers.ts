import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Carrier } from '@/types/db'

export type LaneMatchKind = 'lane' | 'origin_metro'

/**
 * Row shape of the `carriers_for_lane` RPC.
 *
 * Two things about these numbers are easy to misread:
 *  - `origin_metro_loads` is the total out of the origin metro and
 *    `lane_loads` is the subset of those that also hit the destination metro,
 *    so they must never be added together.
 *  - `avg_rate_per_mile` is averaged over that same origin-metro scope, not
 *    over the exact lane, so it is what this carrier costs out of the pickup
 *    area rather than a quote for this particular run.
 *
 * `on_time_delivery_pct` is null — never 0 — until an actual arrival has been
 * logged against one of their stops.
 */
export interface LaneCarrierRow {
  carrier_id: string
  carrier_name: string
  dot_number: string | null
  status: Carrier['status']
  lane_loads: number
  origin_metro_loads: number
  avg_rate_per_mile: number | null
  last_hauled_at: string | null
  on_time_delivery_pct: number | null
  match_kind: LaneMatchKind
}

/**
 * "Who has run this before?" — carriers with history out of the origin metro,
 * exact-lane matches ranked first. Metro to metro deliberately: asking for the
 * exact pickup town turns thirty options into three.
 *
 * Disabled without an origin metro. A tender whose pickup city has not been
 * resolved to a metro has nothing to match on, and firing the RPC with a null
 * origin would just scan every load in the desk to return nothing.
 */
export function useLaneCarriers(
  originMetroId: string | null | undefined,
  destMetroId?: string | null,
) {
  return useQuery<LaneCarrierRow[]>({
    queryKey: ['lane_carriers', originMetroId ?? null, destMetroId ?? null],
    enabled: Boolean(originMetroId),
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('carriers_for_lane', {
        p_origin_metro: originMetroId,
        p_dest_metro: destMetroId ?? null,
      })
      if (error) throw error
      return (data ?? []) as LaneCarrierRow[]
    },
  })
}
