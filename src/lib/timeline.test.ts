import { describe, expect, it } from 'vitest'
import { buildTimeline, dayLabel, groupByDay, type TimelineNote } from './timeline'
import type { LoadStatusHistory } from '@/types/db'

const stages = [
  { id: 's-new', label: 'New' },
  { id: 's-booked', label: 'Booked' },
]
const profiles = [
  { id: 'p-dana', full_name: 'Dana Ruiz', email: 'dana@example.com' },
  { id: 'p-ops', full_name: null, email: 'ops@example.com' },
]
const loads = [{ id: 'l-1', load_number: 'L-1001' }]

function note(over: Partial<TimelineNote> = {}): TimelineNote {
  return {
    id: 'n1',
    created_at: '2026-09-10T10:00:00Z',
    body: 'Asked for quick pay',
    interaction_type_label: 'Quick pay request',
    severity: 'warn',
    load_id: null,
    load_number: null,
    created_by_name: 'Dana Ruiz',
    follow_up_at: null,
    ...over,
  }
}

function stage(over: Partial<LoadStatusHistory> = {}): LoadStatusHistory {
  return {
    id: 'h1',
    load_id: 'l-1',
    from_stage_id: 's-new',
    to_stage_id: 's-booked',
    changed_by: 'p-dana',
    changed_at: '2026-09-11T08:00:00Z',
    note: null,
    ...over,
  }
}

function build(notes: TimelineNote[], stageEvents: LoadStatusHistory[]) {
  return buildTimeline({ notes, stageEvents, loads, stages, profiles })
}

describe('one history for a record', () => {
  it('merges notes and stage changes, newest first', () => {
    const t = build([note()], [stage()])
    expect(t.map((i) => i.kind)).toEqual(['stage', 'note'])
  })

  it('says a stage change in words, with the load and who moved it', () => {
    const [s] = build([], [stage()])
    expect(s.title).toBe('Moved to Booked')
    expect(s.body).toBe('from New')
    expect(s.loadNumber).toBe('L-1001')
    expect(s.loadId).toBe('l-1')
    expect(s.who).toBe('Dana Ruiz')
  })

  it("a load's first stage reads as created, and carries its note", () => {
    const [s] = build([], [stage({ from_stage_id: null, note: 'from the connector' })])
    expect(s.title).toBe('Created as Booked')
    expect(s.body).toBe('from the connector')
  })

  it('falls back to an email when a profile has no name, and to nothing when unknown', () => {
    const [byOps] = build([], [stage({ changed_by: 'p-ops' })])
    expect(byOps.who).toBe('ops@example.com')
    const [byGhost] = build([], [stage({ changed_by: 'p-ghost' })])
    expect(byGhost.who).toBeNull()
    const [bySystem] = build([], [stage({ changed_by: null })])
    expect(bySystem.who).toBeNull()
  })

  it("keeps a note's severity, load and follow-up", () => {
    const [n] = build(
      [note({ severity: 'critical', load_id: 'l-1', load_number: 'L-1001', follow_up_at: '2026-09-15T00:00:00Z' })],
      [],
    )
    expect(n.severity).toBe('critical')
    expect(n.loadNumber).toBe('L-1001')
    expect(n.followUpAt).toBe('2026-09-15T00:00:00Z')
  })

  it('a note without a severity is plain information', () => {
    const [n] = build([note({ severity: undefined })], [])
    expect(n.severity).toBe('info')
  })

  it('at the same instant, the note reads before the stage change', () => {
    const at = '2026-09-11T08:00:00Z'
    const t = build([note({ created_at: at })], [stage({ changed_at: at })])
    expect(t.map((i) => i.kind)).toEqual(['note', 'stage'])
  })

  it('an unknown stage still renders instead of disappearing', () => {
    const [s] = build([], [stage({ to_stage_id: 'gone' })])
    expect(s.title).toBe('Moved to a new stage')
  })
})

describe('day separators', () => {
  // Built in local time, like the dates the feed renders, so the labels do
  // not depend on the zone the tests run in.
  const now = new Date(2026, 8, 20, 12, 0, 0)

  it('names today and yesterday', () => {
    expect(dayLabel(new Date(2026, 8, 20, 9).toISOString(), now)).toBe('Today')
    expect(dayLabel(new Date(2026, 8, 19, 23, 59).toISOString(), now)).toBe('Yesterday')
  })

  it('shows the year only when it differs', () => {
    expect(dayLabel(new Date(2026, 8, 1, 10).toISOString(), now)).toMatch(/Sep 1$/)
    expect(dayLabel(new Date(2025, 11, 24, 10).toISOString(), now)).toMatch(/2025/)
  })

  it('groups a sorted feed by day without reordering it', () => {
    const items = buildTimeline({
      notes: [
        note({ id: 'a', created_at: new Date(2026, 8, 20, 11).toISOString() }),
        note({ id: 'b', created_at: new Date(2026, 8, 20, 9).toISOString() }),
        note({ id: 'c', created_at: new Date(2026, 8, 19, 9).toISOString() }),
      ],
      stageEvents: [],
      loads,
      stages,
      profiles,
    })
    const days = groupByDay(items, now)
    expect(days.map((d) => d.day)).toEqual(['Today', 'Yesterday'])
    expect(days[0].items.map((i) => i.id)).toEqual(['note:a', 'note:b'])
    expect(days[1].items.map((i) => i.id)).toEqual(['note:c'])
  })
})
