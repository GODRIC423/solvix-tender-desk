/**
 * CSV in and out.
 *
 * Hand-rolled rather than a dependency because the whole surface is: quoted
 * fields, doubled quotes inside them, CR/LF line endings, and a BOM from
 * Excel. Everything a broker's spreadsheet will throw at us, nothing more.
 */

/** Parse CSV text into rows of cells. Quotes and embedded newlines handled. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '')
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false

  for (let i = 0; i < src.length; i++) {
    const ch = src[i]

    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        cell += ch
      }
      continue
    }

    if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      row.push(cell)
      cell = ''
    } else if (ch === '\r') {
      // swallow; the \n that follows ends the row
    } else if (ch === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else {
      cell += ch
    }
  }
  // Last row without a trailing newline.
  if (cell.length > 0 || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }

  // Drop rows that are entirely blank (Excel loves a trailing one).
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

function escapeCell(v: unknown): string {
  if (v === null || v === undefined) return ''
  const s = Array.isArray(v) ? v.join('; ') : String(v)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Serialize rows to CSV with CRLF endings, the dialect Excel reads cleanly. */
export function toCsv(rows: unknown[][]): string {
  return rows.map((r) => r.map(escapeCell).join(',')).join('\r\n') + '\r\n'
}

export interface ParsedTable {
  headers: string[]
  rows: Record<string, string>[]
}

/**
 * Header-keyed rows. Headers are normalised (trimmed, lowercased, spaces to
 * underscores) so "Dispatch Contact Phone" and "dispatch_contact_phone" both
 * land on the same key.
 */
export function csvToObjects(text: string): ParsedTable {
  const grid = parseCsv(text)
  if (grid.length === 0) return { headers: [], rows: [] }
  const headers = grid[0].map(normalizeHeader)
  const rows = grid.slice(1).map((cells) => {
    const obj: Record<string, string> = {}
    headers.forEach((h, i) => {
      obj[h] = (cells[i] ?? '').trim()
    })
    return obj
  })
  return { headers, rows }
}

export function normalizeHeader(h: string): string {
  return h
    .replace(/^﻿/, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

/** Trigger a browser download of text content. */
export function downloadText(filename: string, text: string, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function todayStamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`
}
