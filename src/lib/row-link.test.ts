import { describe, expect, it } from 'vitest'
import { isInteractiveTarget, rowClickIntent, type RowClickLike } from './row-link'

// Stand-ins for DOM elements: the only thing the decision looks at is
// whether `closest()` finds a control.
const plainCell = { closest: () => null }
const insideLink = { closest: (selector: string) => (selector.startsWith('a,') ? {} : null) }

function click(over: Partial<RowClickLike> = {}): RowClickLike {
  return { target: plainCell, button: 0, metaKey: false, ctrlKey: false, shiftKey: false, ...over }
}

describe('what a click on a row means', () => {
  it('a plain click opens the record here', () => {
    expect(rowClickIntent(click())).toBe('navigate')
  })

  it('⌘-click, Ctrl-click and Shift-click open a new tab, like a link', () => {
    expect(rowClickIntent(click({ metaKey: true }))).toBe('new-tab')
    expect(rowClickIntent(click({ ctrlKey: true }))).toBe('new-tab')
    expect(rowClickIntent(click({ shiftKey: true }))).toBe('new-tab')
  })

  it('a middle click opens a new tab', () => {
    expect(rowClickIntent(click({ button: 1 }))).toBe('new-tab')
  })

  it('a right click is left to the browser', () => {
    expect(rowClickIntent(click({ button: 2 }))).toBe('ignore')
  })

  it('a click on a control inside the row belongs to the control', () => {
    expect(rowClickIntent(click({ target: insideLink }))).toBe('ignore')
  })

  it('finishing a text selection does not navigate away', () => {
    expect(rowClickIntent(click(), 'DOT 2345678')).toBe('ignore')
    expect(rowClickIntent(click(), '   ')).toBe('navigate')
  })

  it('an event something else already handled is ignored', () => {
    expect(rowClickIntent(click({ defaultPrevented: true }))).toBe('ignore')
  })
})

describe('isInteractiveTarget', () => {
  it('is false for a plain cell, nothing, or a non-element', () => {
    expect(isInteractiveTarget(plainCell)).toBe(false)
    expect(isInteractiveTarget(null)).toBe(false)
    expect(isInteractiveTarget(undefined)).toBe(false)
    expect(isInteractiveTarget('text')).toBe(false)
  })

  it('is true anywhere inside a link or button', () => {
    expect(isInteractiveTarget(insideLink)).toBe(true)
  })
})
