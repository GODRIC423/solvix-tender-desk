import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Band } from '@/lib/qc-bands'
import type { LoadStop, LoadTrackingEvent } from '@/types/db'

/** The two `load_stops` columns this module maintains. */
export type StopActualField = 'actual_arrival' | 'actual_departure'

/** Fallback for `org_settings.on_time_grace_minutes`, which defaults to 15 in SQL. */
export const DEFAULT_ON_TIME_GRACE_MINUTES = 15

const VIEWER_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

const VERB: Record<StopActualField, string> = {
  actual_arrival: 'Arrived',
  actual_departure: 'Departed',
}

/**
 * `load_stops.timezone` (migration 20260101000005) exists in the database but
 * is not on the shared `LoadStop` type yet. Read it in one place so the gap is
 * visible rather than spread across the UI.
 */
export function stopTimezone(stop: LoadStop): string | null {
  return (stop as LoadStop & { timezone?: string | null }).timezone ?? null
}

export interface StopZone {
  zone: string
  /**
   * True when `zone` is the dock's own zone — the frame everyone on the phone
   * is speaking in. False means we fell back to the browser's zone, which
   * matches the dock only by accident and has to be labelled as such.
   */
  dockLocal: boolean
}

export function resolveStopZone(stop: LoadStop): StopZone {
  const recorded = stopTimezone(stop)
  if (recorded) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: recorded })
      return { zone: recorded, dockLocal: true }
    } catch {
      // A zone string Intl doesn't recognise would otherwise throw on render.
    }
  }
  return { zone: VIEWER_ZONE, dockLocal: false }
}

function zonedParts(at: Date, zone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at)
  const num = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0')
  return {
    year: num('year'),
    month: num('month'),
    day: num('day'),
    hour: num('hour'),
    minute: num('minute'),
    second: num('second'),
  }
}

/** Offset of `zone` from UTC, in ms, at a given instant. */
function zoneOffsetMs(at: Date, zone: string): number {
  const p = zonedParts(at, zone)
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return wall - Math.floor(at.getTime() / 1000) * 1000
}

/** "Sep 8, 3:42 PM CDT" — the zone is always named so the reading can't be misread. */
export function formatInZone(iso: string, zone: string): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return '—'
  return new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(at)
}

/** `YYYY-MM-DDTHH:mm` for a datetime-local input, read in `zone`. */
export function toDateTimeLocal(iso: string, zone: string): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ''
  const p = zonedParts(at, zone)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`
}

/**
 * Inverse of `toDateTimeLocal`. A `datetime-local` input is read in the
 * browser's zone, but the time a dispatcher types is the time on the dock's
 * clock — a California pickup logged from an Atlanta desk is otherwise three
 * hours wrong, which is the same bug migration 20260101000005 exists to fix.
 */
export function fromDateTimeLocal(value: string, zone: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value)
  if (!m) return null
  const wall = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]))
  // The offset depends on the instant being solved for, so guess with the
  // offset at the naive reading and correct once — enough to land on the right
  // side of a DST change.
  const guess = wall - zoneOffsetMs(new Date(wall), zone)
  return new Date(wall - zoneOffsetMs(new Date(guess), zone)).toISOString()
}

/** "42m", "1h 30m", "2d 3h" — 1h05 late and 1h55 late are different conversations. */
export function formatMinutes(total: number): string {
  const m = Math.abs(Math.round(total))
  if (m < 60) return `${m}m`
  const hours = Math.floor(m / 60)
  const mins = m % 60
  if (hours < 24) return mins ? `${hours}h ${mins}m` : `${hours}h`
  const days = Math.floor(hours / 24)
  const rem = hours % 24
  return rem ? `${days}d ${rem}h` : `${days}d`
}

export interface Lateness {
  band: Band
  /** Already phrased for display: "on time", "42m late". */
  label: string
  minutesLate: number
}

/**
 * How an arrival landed against what was promised. The commitment is the
 * explicit appointment if there is one, otherwise the close of the window —
 * the same `coalesce(appointment, latest)` `v_load_performance` uses, so the
 * badge on the stop and the carrier's on-time percentage can never disagree.
 *
 * Null means there is nothing to judge: no arrival logged, or no commitment on
 * the stop. Both are different from "late" and must not render as one.
 */
export function latenessFor(
  arrivalIso: string | null,
  stop: LoadStop,
  graceMinutes: number,
): Lateness | null {
  const due = stop.appointment ?? stop.latest
  if (!arrivalIso || !due) return null
  const minutesLate = Math.round(
    (new Date(arrivalIso).getTime() - new Date(due).getTime()) / 60_000,
  )
  if (Number.isNaN(minutesLate)) return null
  if (minutesLate <= 0) return { band: 'green', label: 'on time', minutesLate }
  if (minutesLate <= graceMinutes) {
    return {
      band: 'yellow',
      label: `${formatMinutes(minutesLate)} late · within grace`,
      minutesLate,
    }
  }
  return { band: 'red', label: `${formatMinutes(minutesLate)} late`, minutesLate }
}

/**
 * The grace window is what turns a logged arrival into an on-time percentage,
 * and `v_load_performance` bakes the same setting into its own answer. Read it
 * here so a stop badge and the carrier scorecard tell the same story.
 */
export function useOnTimeGrace() {
  return useQuery<number>({
    queryKey: ['org_settings', 'on_time_grace_minutes'],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('org_settings')
        .select('on_time_grace_minutes')
        .eq('id', 1)
        .maybeSingle()
      if (error || !data) return DEFAULT_ON_TIME_GRACE_MINUTES
      return (data.on_time_grace_minutes as number | null) ?? DEFAULT_ON_TIME_GRACE_MINUTES
    },
  })
}

function stopLabel(stop: LoadStop): string {
  const seq = stop.sequence == null ? '' : ` ${stop.sequence}`
  const where = stop.name?.trim() || [stop.city, stop.state].filter(Boolean).join(', ')
  return `${stop.stop_type ?? 'stop'}${seq}${where ? ` · ${where}` : ''}`
}

function stopLocation(stop: LoadStop): string | null {
  return [stop.city, stop.state].filter(Boolean).join(', ') || stop.name || null
}

/**
 * `load_stops` has no trigger onto `loads.last_touched_at`, so writing the stop
 * on its own leaves the board believing nobody has been near this load — and
 * the booked-load urgency colour turns on exactly that. A tracking event is how
 * the rest of the app records a touch (the insert trigger does the bump), and
 * an arrival belongs in the load's timeline regardless.
 */
async function logTouch(
  loadId: string,
  type: LoadTrackingEvent['type'],
  note: string,
  location: string | null,
) {
  const { error } = await supabase
    .from('load_tracking_events')
    .insert({ load_id: loadId, type, note, location })
  // The actual is already saved; throwing here would tell the dispatcher their
  // entry didn't stick when it did.
  if (error) console.error('[solvix] failed to log stop actual as a tracking event', error)
}

export interface SetStopActualInput {
  stop: LoadStop
  field: StopActualField
  /** Omit for the one-click case — the dispatcher is on the phone right now. */
  at?: string
}

export interface ClearStopActualInput {
  stop: LoadStop
  field: StopActualField
}

/**
 * Recording when the truck actually showed up and left.
 *
 * These two columns are the only input to every on-time number the desk
 * reports, so a correction is as load-bearing as the original entry: clearing
 * one silently removes a load from the carrier's rated count. Both writes go
 * into the load's timeline for that reason.
 */
export function useStopActuals(loadId: string) {
  const qc = useQueryClient()

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['load', loadId] })
    qc.invalidateQueries({ queryKey: ['load_board'] })
    // On-time percentages are derived from these columns.
    qc.invalidateQueries({ queryKey: ['carrier_performance'] })
  }

  const set = useMutation({
    mutationFn: async ({ stop, field, at }: SetStopActualInput) => {
      const stamp = at ?? new Date().toISOString()
      const { error } = await supabase
        .from('load_stops')
        .update({ [field]: stamp })
        .eq('id', stop.id)
      if (error) throw error

      await logTouch(
        loadId,
        'status_update',
        `${VERB[field]} ${stopLabel(stop)} — ${formatInZone(stamp, resolveStopZone(stop).zone)}`,
        stopLocation(stop),
      )
    },
    onSuccess: invalidate,
  })

  const clear = useMutation({
    mutationFn: async ({ stop, field }: ClearStopActualInput) => {
      const { error } = await supabase
        .from('load_stops')
        .update({ [field]: null })
        .eq('id', stop.id)
      if (error) throw error

      await logTouch(
        loadId,
        'dispatcher_note',
        `Cleared ${VERB[field].toLowerCase()} time on ${stopLabel(stop)}`,
        stopLocation(stop),
      )
    },
    onSuccess: invalidate,
  })

  return { set, clear }
}
