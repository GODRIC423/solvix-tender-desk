import type { LoadStatusHistory } from '@/types/db'

export type TimelineSeverity = 'info' | 'warn' | 'critical'
export type TimelineKind = 'note' | 'stage'

/** What a logged note contributes — the shape both interaction views share. */
export interface TimelineNote {
  id: string
  created_at: string
  body: string
  interaction_type_label: string
  severity?: TimelineSeverity
  load_id: string | null
  load_number: string | null
  created_by_name: string | null
  follow_up_at: string | null
}

export interface TimelineItem {
  id: string
  kind: TimelineKind
  at: string
  title: string
  body: string | null
  who: string | null
  loadId: string | null
  loadNumber: string | null
  severity: TimelineSeverity
  followUpAt: string | null
}

export interface TimelineInput {
  notes: TimelineNote[]
  stageEvents: LoadStatusHistory[]
  loads: Array<{ id: string; load_number: string }>
  stages: Array<{ id: string; label: string }>
  profiles: Array<{ id: string; full_name: string | null; email: string | null }>
}

/**
 * One history for a record: every note anyone logged, and every stage a load
 * of theirs moved through, newest first. This is what "show me everything on
 * this carrier" means — the notes say what people said, the stage changes
 * say what actually happened.
 */
export function buildTimeline(input: TimelineInput): TimelineItem[] {
  const stageLabel = new Map(input.stages.map((s) => [s.id, s.label]))
  const loadNumber = new Map(input.loads.map((l) => [l.id, l.load_number]))
  const who = new Map(input.profiles.map((p) => [p.id, p.full_name ?? p.email]))

  const notes: TimelineItem[] = input.notes.map((n) => ({
    id: `note:${n.id}`,
    kind: 'note',
    at: n.created_at,
    title: n.interaction_type_label,
    body: n.body,
    who: n.created_by_name,
    loadId: n.load_id,
    loadNumber: n.load_number,
    severity: n.severity ?? 'info',
    followUpAt: n.follow_up_at,
  }))

  const stages: TimelineItem[] = input.stageEvents.map((e) => {
    const to = stageLabel.get(e.to_stage_id) ?? 'a new stage'
    const from = e.from_stage_id ? stageLabel.get(e.from_stage_id) : undefined
    return {
      id: `stage:${e.id}`,
      kind: 'stage',
      at: e.changed_at,
      title: from ? `Moved to ${to}` : `Created as ${to}`,
      body: from ? `from ${from}${e.note ? ` — ${e.note}` : ''}` : e.note,
      who: e.changed_by ? (who.get(e.changed_by) ?? null) : null,
      loadId: e.load_id,
      loadNumber: loadNumber.get(e.load_id) ?? null,
      severity: 'info',
      followUpAt: null,
    }
  })

  return [...notes, ...stages].sort((a, b) => {
    const byTime = Date.parse(b.at) - Date.parse(a.at)
    if (byTime !== 0) return byTime
    // Same instant (a note logged as the stage changed): the note reads first.
    if (a.kind !== b.kind) return a.kind === 'note' ? -1 : 1
    return a.id < b.id ? -1 : 1
  })
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  )
}

/** "Today", "Yesterday", or a short date — the separators in the feed. */
export function dayLabel(iso: string, now: Date = new Date()): string {
  const d = new Date(iso)
  if (sameDay(d, now)) return 'Today'
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (sameDay(d, yesterday)) return 'Yesterday'
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' as const } : {}),
  })
}

/** Groups an already-sorted timeline by calendar day, keeping its order. */
export function groupByDay(
  items: TimelineItem[],
  now: Date = new Date(),
): Array<{ day: string; items: TimelineItem[] }> {
  const out: Array<{ day: string; items: TimelineItem[] }> = []
  for (const item of items) {
    const day = dayLabel(item.at, now)
    const last = out[out.length - 1]
    if (last && last.day === day) last.items.push(item)
    else out.push({ day, items: [item] })
  }
  return out
}
