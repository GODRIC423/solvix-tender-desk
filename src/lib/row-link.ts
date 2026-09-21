/**
 * Whole-row links.
 *
 * A table row that opens a record has to behave like a link, not a button:
 * a plain click opens it here; ⌘/Ctrl-click, Shift-click or a middle click
 * open it in a new tab; and anything inside the row with its own behaviour
 * (a link to a load, a phone number, a button) is left alone. This is the
 * pure decision — components/RowLink.tsx wires it to the router.
 */
export type RowClickIntent = 'ignore' | 'navigate' | 'new-tab'

/** Anything inside a row that already does something when clicked. */
export const INTERACTIVE_SELECTOR =
  'a, button, input, select, textarea, label, summary, [role="button"], [data-row-link-ignore]'

interface ClosestLike {
  closest?: (selector: string) => unknown
}

/** True when the click landed on a control that has its own behaviour. */
export function isInteractiveTarget(target: unknown): boolean {
  const el = target as ClosestLike | null | undefined
  if (!el || typeof el.closest !== 'function') return false
  return el.closest(INTERACTIVE_SELECTOR) != null
}

export interface RowClickLike {
  target: unknown
  button: number
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  defaultPrevented?: boolean
}

/**
 * @param selectionText whatever text the user has selected — a click that
 *   ends a drag-to-copy of a DOT number must not navigate away.
 */
export function rowClickIntent(e: RowClickLike, selectionText = ''): RowClickIntent {
  if (e.defaultPrevented) return 'ignore'
  if (isInteractiveTarget(e.target)) return 'ignore'
  if (selectionText.trim() !== '') return 'ignore'
  if (e.button === 1) return 'new-tab'
  if (e.button !== 0) return 'ignore'
  if (e.metaKey || e.ctrlKey || e.shiftKey) return 'new-tab'
  return 'navigate'
}
