import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { groupByDay, type TimelineItem, type TimelineKind } from '@/lib/timeline'
import { relativeTime } from '@/lib/urgency'

type Filter = 'all' | TimelineKind

/**
 * The history feed on a carrier or customer: notes people logged and the
 * stages their loads moved through, in one list, newest first, split by day.
 */
export default function RecordTimeline({
  items,
  emptyText,
}: {
  items: TimelineItem[]
  emptyText: string
}) {
  const [filter, setFilter] = useState<Filter>('all')

  const counts = useMemo(
    () => ({
      note: items.filter((i) => i.kind === 'note').length,
      stage: items.filter((i) => i.kind === 'stage').length,
    }),
    [items],
  )
  const shown = useMemo(
    () => (filter === 'all' ? items : items.filter((i) => i.kind === filter)),
    [items, filter],
  )
  const days = useMemo(() => groupByDay(shown), [shown])

  return (
    <section className="card p-3">
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <h2 className="mr-auto text-sm font-semibold text-slate-200">History</h2>
        <FilterChip active={filter === 'all'} onClick={() => setFilter('all')}>
          All · {items.length}
        </FilterChip>
        <FilterChip active={filter === 'note'} onClick={() => setFilter('note')}>
          Notes · {counts.note}
        </FilterChip>
        <FilterChip active={filter === 'stage'} onClick={() => setFilter('stage')}>
          Load events · {counts.stage}
        </FilterChip>
      </div>

      {shown.length === 0 ? (
        <p className="text-xs text-slate-500">{emptyText}</p>
      ) : (
        <ol className="space-y-4">
          {days.map(({ day, items: dayItems }) => (
            <li key={day}>
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {day}
              </div>
              <ul className="space-y-2.5 border-l border-ink-700 pl-3">
                {dayItems.map((item) => (
                  <Entry key={item.id} item={item} />
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-2 py-0.5 text-xs transition ${
        active
          ? 'border-accent/40 bg-accent/15 text-accent'
          : 'border-ink-700 text-slate-400 hover:bg-ink-800 hover:text-slate-200'
      }`}
    >
      {children}
    </button>
  )
}

function Entry({ item }: { item: TimelineItem }) {
  const isStage = item.kind === 'stage'
  const dot = isStage
    ? 'bg-slate-500'
    : item.severity === 'critical'
      ? 'bg-band-red'
      : item.severity === 'warn'
        ? 'bg-band-yellow'
        : 'bg-accent'
  const overdue = item.followUpAt ? Date.parse(item.followUpAt) < Date.now() : false

  return (
    <li className="relative text-sm">
      <span className={`absolute -left-4 top-1.5 h-2 w-2 rounded-full ${dot}`} />
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className={isStage ? 'text-slate-300' : 'font-medium text-slate-200'}>{item.title}</span>
        {item.loadNumber && item.loadId && (
          <Link to={`/loads/${item.loadId}`} className="text-xs text-accent hover:underline">
            {item.loadNumber}
          </Link>
        )}
        <span className="ml-auto text-xs text-slate-500">
          {item.who ?? (isStage ? 'system' : 'someone')} · {relativeTime(item.at)}
        </span>
      </div>
      {item.body && (
        <div className={isStage ? 'text-xs text-slate-500' : 'text-slate-300'}>{item.body}</div>
      )}
      {item.followUpAt && (
        <div className={`text-xs ${overdue ? 'text-red-300' : 'text-amber-300'}`}>
          {overdue ? 'Follow-up overdue' : 'Follow up'} {relativeTime(item.followUpAt)}
        </div>
      )}
    </li>
  )
}
