import { useMemo, useState } from 'react'
import { csvToObjects, downloadText, normalizeHeader, toCsv } from '@/lib/csv'

/**
 * Describes one column of an import template: what it's called, whether it
 * must be filled, what a good value looks like, and — for status-type
 * columns — the exact values the database will accept.
 */
export interface CsvColumn {
  key: string
  label: string
  required?: boolean
  example: string
  help?: string
  /** Allowed values (case-insensitive). The template lists them. */
  values?: string[]
}

export interface ImportResult {
  inserted: number
  updated: number
  skipped: number
  errors: Array<{ row: number; error: string }>
}

interface RowCheck {
  index: number
  data: Record<string, string>
  problems: string[]
  isExample: boolean
}

/**
 * Template → fill it in → drop it back → preview → import.
 *
 * "Create just a template ... that way you get it in the format that you
 * need." The template is generated from the same column list that drives
 * validation, so it cannot drift from what the importer accepts. Example
 * rows in the template are marked and skipped automatically, which is the
 * trap the previous sentence sets up.
 */
export default function CsvImport({
  title,
  entity,
  columns,
  onImport,
  templateFilename,
  onDone,
}: {
  title: string
  entity: string
  columns: CsvColumn[]
  onImport: (rows: Record<string, string>[]) => Promise<ImportResult>
  templateFilename: string
  onDone?: () => void
}) {
  const [fileName, setFileName] = useState<string | null>(null)
  const [parsed, setParsed] = useState<{ headers: string[]; rows: Record<string, string>[] } | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const labelToKey = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of columns) {
      m.set(c.key, c.key)
      m.set(normalizeHeader(c.label), c.key)
    }
    return m
  }, [columns])

  function downloadTemplate() {
    const header = columns.map((c) => c.label)
    const example = columns.map((c) => c.example)
    // A second example row shows the alternative status values so people
    // see them in context, not just in the guide.
    const second = columns.map((c) =>
      c.values && c.values.length > 1 ? c.values[1] : c.key === 'name' ? 'EXAMPLE — delete this row too' : '',
    )
    downloadText(templateFilename, toCsv([header, example, second]))
  }

  async function onFile(file: File) {
    setError(null)
    setResult(null)
    setFileName(file.name)
    try {
      const text = await file.text()
      const table = csvToObjects(text)
      // Map whatever headers they used onto our keys.
      const rows = table.rows.map((r) => {
        const out: Record<string, string> = {}
        for (const [h, v] of Object.entries(r)) {
          const key = labelToKey.get(h)
          if (key) out[key] = v
        }
        return out
      })
      setParsed({ headers: table.headers, rows })
    } catch (e) {
      setError((e as Error).message)
      setParsed(null)
    }
  }

  const checks: RowCheck[] = useMemo(() => {
    if (!parsed) return []
    return parsed.rows.map((data, i) => {
      const problems: string[] = []
      const isExample = /^example\b/i.test(data.name ?? '')
      for (const c of columns) {
        const v = (data[c.key] ?? '').trim()
        if (c.required && !v) problems.push(`${c.label} is required`)
        if (v && c.values) {
          const norm = v.toLowerCase().replace(/\s+/g, '_')
          if (!c.values.map((x) => x.toLowerCase()).includes(norm)) {
            problems.push(`${c.label} must be one of: ${c.values.join(', ')}`)
          }
        }
      }
      return { index: i + 1, data, problems, isExample }
    })
  }, [parsed, columns])

  const unknownHeaders = useMemo(
    () => (parsed ? parsed.headers.filter((h) => !labelToKey.has(h)) : []),
    [parsed, labelToKey],
  )
  const missingRequired = useMemo(
    () =>
      parsed
        ? columns.filter((c) => c.required && !parsed.headers.some((h) => labelToKey.get(h) === c.key))
        : [],
    [parsed, columns, labelToKey],
  )

  const importable = checks.filter((c) => c.problems.length === 0 && !c.isExample)
  const skipped = checks.length - importable.length

  async function runImport() {
    setBusy(true)
    setError(null)
    try {
      const res = await onImport(importable.map((c) => c.data))
      setResult(res)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card p-3">
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-semibold text-slate-200">{title}</h2>
        <div className="ml-auto flex items-center gap-2">
          <button className="btn text-xs" onClick={downloadTemplate}>
            Download template
          </button>
          <label className="btn btn-primary cursor-pointer text-xs">
            Choose file…
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void onFile(f)
                e.currentTarget.value = ''
              }}
            />
          </label>
          {onDone && (
            <button className="btn text-xs" onClick={onDone}>
              Close
            </button>
          )}
        </div>
      </div>

      <p className="mb-3 text-xs text-slate-500">
        Download the template, fill it in (Excel is fine — save as CSV), then choose the file.
        Existing {entity} are matched and updated, not duplicated. Rows are checked before
        anything is written.
      </p>

      {/* -------------------------------------------------- column guide */}
      <details className="mb-3">
        <summary className="cursor-pointer text-xs font-medium text-slate-300">
          Column guide — what goes in each column
        </summary>
        <table className="mt-2 w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-ink-700 text-left text-slate-400">
              <th className="py-1 pr-3">Column</th>
              <th className="py-1 pr-3">Required</th>
              <th className="py-1 pr-3">Example</th>
              <th className="py-1">Notes</th>
            </tr>
          </thead>
          <tbody>
            {columns.map((c) => (
              <tr key={c.key} className="border-b border-ink-800 align-top">
                <td className="py-1 pr-3 font-medium text-slate-200">{c.label}</td>
                <td className="py-1 pr-3">{c.required ? <span className="text-amber-300">yes</span> : 'no'}</td>
                <td className="py-1 pr-3 font-mono text-slate-400">{c.example}</td>
                <td className="py-1 text-slate-400">
                  {c.help}
                  {c.values && (
                    <div className="mt-0.5">
                      Allowed: {c.values.map((v) => (
                        <code key={v} className="mr-1 rounded bg-ink-800 px-1">
                          {v}
                        </code>
                      ))}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>

      {error && (
        <div className="mb-3 rounded border border-band-red/40 bg-band-red/10 p-2 text-xs text-red-300">
          {error}
        </div>
      )}

      {/* --------------------------------------------------------- preview */}
      {parsed && !result && (
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-3 text-xs">
            <span className="text-slate-300">
              <span className="font-medium">{fileName}</span> · {checks.length} row
              {checks.length === 1 ? '' : 's'}
            </span>
            <span className="text-emerald-300">{importable.length} ready</span>
            {skipped > 0 && <span className="text-amber-300">{skipped} will be skipped</span>}
            {unknownHeaders.length > 0 && (
              <span className="text-slate-500" title={unknownHeaders.join(', ')}>
                {unknownHeaders.length} column{unknownHeaders.length === 1 ? '' : 's'} ignored
              </span>
            )}
            <button
              className="btn btn-primary ml-auto text-xs"
              disabled={busy || importable.length === 0 || missingRequired.length > 0}
              onClick={runImport}
            >
              {busy ? 'Importing…' : `Import ${importable.length} ${entity}`}
            </button>
          </div>

          {missingRequired.length > 0 && (
            <div className="mb-2 rounded border border-band-red/40 bg-band-red/10 p-2 text-xs text-red-300">
              The file has no <span className="font-medium">{missingRequired.map((c) => c.label).join(', ')}</span>{' '}
              column. Use the template headers.
            </div>
          )}

          <div className="max-h-80 overflow-auto rounded border border-ink-700">
            <table className="w-full border-collapse text-xs">
              <thead className="sticky top-0 bg-ink-850">
                <tr className="border-b border-ink-700 text-left text-slate-400">
                  <th className="px-2 py-1">#</th>
                  <th className="px-2 py-1">Status</th>
                  {columns.slice(0, 6).map((c) => (
                    <th key={c.key} className="px-2 py-1">
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {checks.map((c) => (
                  <tr key={c.index} className="border-b border-ink-800">
                    <td className="px-2 py-1 text-slate-500">{c.index}</td>
                    <td className="px-2 py-1">
                      {c.isExample ? (
                        <span className="text-slate-500">example row — skipped</span>
                      ) : c.problems.length === 0 ? (
                        <span className="text-emerald-300">ready</span>
                      ) : (
                        <span className="text-red-300" title={c.problems.join('\n')}>
                          {c.problems[0]}
                          {c.problems.length > 1 ? ` (+${c.problems.length - 1})` : ''}
                        </span>
                      )}
                    </td>
                    {columns.slice(0, 6).map((col) => (
                      <td key={col.key} className="max-w-[12rem] truncate px-2 py-1 text-slate-300">
                        {c.data[col.key] ?? ''}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------- result */}
      {result && (
        <div className="rounded border border-band-green/40 bg-band-green/10 p-3 text-sm">
          <div className="font-medium text-emerald-300">Import finished</div>
          <div className="mt-1 text-xs text-slate-300">
            {result.inserted} added · {result.updated} updated · {result.skipped + skipped} skipped
          </div>
          {result.errors.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-xs text-amber-300">
              {result.errors.slice(0, 20).map((e, i) => (
                <li key={i}>
                  Row {e.row}: {e.error}
                </li>
              ))}
              {result.errors.length > 20 && <li>…and {result.errors.length - 20} more</li>}
            </ul>
          )}
          <button
            className="btn mt-2 text-xs"
            onClick={() => {
              setParsed(null)
              setResult(null)
              setFileName(null)
            }}
          >
            Import another file
          </button>
        </div>
      )}
    </div>
  )
}

/** Turn rows into a CSV download using the column labels as headers. */
export function exportRows<T extends Record<string, unknown>>(
  filename: string,
  columns: Array<{ key: keyof T & string; label: string }>,
  rows: T[],
) {
  const header = columns.map((c) => c.label)
  const body = rows.map((r) => columns.map((c) => r[c.key] ?? ''))
  downloadText(filename, toCsv([header, ...body]))
}
