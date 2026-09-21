import type { KeyboardEvent, MouseEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { isInteractiveTarget, rowClickIntent, type RowClickIntent } from '@/lib/row-link'

/** Classes for a row that opens a record: it looks, and focuses, like a link. */
export const ROW_LINK_CLASS =
  'cursor-pointer border-b border-ink-800 transition hover:bg-ink-850 focus:outline-none ' +
  'focus-visible:bg-ink-850 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent/60'

/**
 * Makes a whole table row open `href`, the way a row in any CRM does. Real
 * link semantics are kept — ⌘/Ctrl-click, Shift-click and middle click open a
 * new tab, Enter opens it from the keyboard — and the controls inside the row
 * keep working on their own.
 *
 *   const link = useRowLink(`/carriers/${c.id}`)
 *   <tr {...link} className={ROW_LINK_CLASS}>…</tr>
 */
export function useRowLink(href: string) {
  const navigate = useNavigate()

  const go = (intent: RowClickIntent) => {
    if (intent === 'new-tab') window.open(href, '_blank', 'noopener,noreferrer')
    else if (intent === 'navigate') navigate(href)
  }

  return {
    role: 'link' as const,
    tabIndex: 0,
    onClick: (e: MouseEvent<HTMLTableRowElement>) =>
      go(rowClickIntent(e, window.getSelection()?.toString() ?? '')),
    // Middle clicks arrive as auxclick, never as click.
    onAuxClick: (e: MouseEvent<HTMLTableRowElement>) => {
      if (e.button === 1) go(rowClickIntent(e))
    },
    onKeyDown: (e: KeyboardEvent<HTMLTableRowElement>) => {
      if (e.key !== 'Enter' || isInteractiveTarget(e.target)) return
      e.preventDefault()
      go(e.metaKey || e.ctrlKey ? 'new-tab' : 'navigate')
    },
  }
}

/** The explicit "open this in a new tab" control at the end of a row. */
export function OpenInNewTab({ href, what = 'record' }: { href: string; what?: string }) {
  const label = `Open ${what} in a new tab`
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={label}
      aria-label={label}
      className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-ink-700 text-slate-400 transition hover:border-accent/50 hover:bg-ink-800 hover:text-accent"
      onClick={(e) => e.stopPropagation()}
    >
      ↗
    </a>
  )
}
