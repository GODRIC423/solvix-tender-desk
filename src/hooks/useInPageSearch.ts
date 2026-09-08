import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * The in-load "Ctrl+F" search.
 *
 * A dispatcher shouldn't need to know which tab a field lives on. They type
 * "lumper" and land on it. This walks the rendered text of a container, wraps
 * hits in <mark>, and steps through them — the same muscle memory as the
 * browser's own find, but scoped to the load and surviving the fact that our
 * fields live inside scrollable panels.
 *
 * It deliberately works on rendered DOM rather than the data model: that way it
 * finds anything the user can see — field labels, values, stop instructions,
 * reference numbers, notes — without us maintaining a separate search index
 * that would drift from the UI.
 */

const HIT_CLASS = 'solvix-hit'
const ACTIVE_CLASS = 'solvix-hit-active'

export interface InPageSearch {
  containerRef: React.RefObject<HTMLDivElement>
  query: string
  setQuery: (q: string) => void
  hitCount: number
  activeIndex: number
  next: () => void
  prev: () => void
  clear: () => void
  /** Bind to an input to get Enter=next, Shift+Enter=prev, Escape=clear. */
  onInputKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void
}

function unwrapHighlights(root: HTMLElement) {
  const marks = root.querySelectorAll(`mark.${HIT_CLASS}`)
  marks.forEach((mark) => {
    const parent = mark.parentNode
    if (!parent) return
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark)
    parent.removeChild(mark)
    parent.normalize()
  })
}

function highlight(root: HTMLElement, query: string): HTMLElement[] {
  if (!query.trim()) return []
  const needle = query.toLowerCase()
  const hits: HTMLElement[] = []

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT
      const parent = node.parentElement
      if (!parent) return NodeFilter.FILTER_REJECT
      // Don't search inside the search box itself, or inside form controls.
      if (parent.closest('[data-search-exclude]')) return NodeFilter.FILTER_REJECT
      const tag = parent.tagName
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'INPUT' || tag === 'TEXTAREA') {
        return NodeFilter.FILTER_REJECT
      }
      return node.nodeValue.toLowerCase().includes(needle)
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT
    },
  })

  const targets: Text[] = []
  let n = walker.nextNode()
  while (n) {
    targets.push(n as Text)
    n = walker.nextNode()
  }

  targets.forEach((textNode) => {
    const text = textNode.nodeValue ?? ''
    const frag = document.createDocumentFragment()
    let cursor = 0
    let idx = text.toLowerCase().indexOf(needle, cursor)
    while (idx !== -1) {
      if (idx > cursor) frag.appendChild(document.createTextNode(text.slice(cursor, idx)))
      const mark = document.createElement('mark')
      mark.className = HIT_CLASS
      mark.textContent = text.slice(idx, idx + needle.length)
      frag.appendChild(mark)
      hits.push(mark)
      cursor = idx + needle.length
      idx = text.toLowerCase().indexOf(needle, cursor)
    }
    if (cursor < text.length) frag.appendChild(document.createTextNode(text.slice(cursor)))
    textNode.parentNode?.replaceChild(frag, textNode)
  })

  return hits
}

export function useInPageSearch(deps: unknown[] = []): InPageSearch {
  const containerRef = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  const [hitCount, setHitCount] = useState(0)
  const [activeIndex, setActiveIndex] = useState(0)
  const hitsRef = useRef<HTMLElement[]>([])

  // Re-run highlighting whenever the query or the underlying content changes.
  useEffect(() => {
    const root = containerRef.current
    if (!root) return
    unwrapHighlights(root)
    const hits = highlight(root, query)
    hitsRef.current = hits
    setHitCount(hits.length)
    setActiveIndex((prev) => (hits.length === 0 ? 0 : Math.min(prev, hits.length - 1)))
    return () => {
      if (containerRef.current) unwrapHighlights(containerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, ...deps])

  // Move the active marker and scroll it into view.
  useEffect(() => {
    const hits = hitsRef.current
    hits.forEach((h) => h.classList.remove(ACTIVE_CLASS))
    const active = hits[activeIndex]
    if (active) {
      active.classList.add(ACTIVE_CLASS)
      active.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }
  }, [activeIndex, hitCount, query])

  const next = useCallback(() => {
    setActiveIndex((i) => (hitsRef.current.length === 0 ? 0 : (i + 1) % hitsRef.current.length))
  }, [])

  const prev = useCallback(() => {
    setActiveIndex((i) =>
      hitsRef.current.length === 0 ? 0 : (i - 1 + hitsRef.current.length) % hitsRef.current.length,
    )
  }, [])

  const clear = useCallback(() => {
    setQuery('')
    setActiveIndex(0)
  }, [])

  const onInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        if (e.shiftKey) prev()
        else next()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        clear()
      }
    },
    [next, prev, clear],
  )

  return {
    containerRef,
    query,
    setQuery,
    hitCount,
    activeIndex,
    next,
    prev,
    clear,
    onInputKeyDown,
  }
}

/**
 * Intercepts the browser's Ctrl+F/Cmd+F inside a page that has an in-page
 * search box, so the familiar shortcut lands in our box instead of the
 * browser's (which can't see inside collapsed panels).
 */
export function useFindShortcut(onOpen: () => void) {
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        onOpen()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onOpen])
}
