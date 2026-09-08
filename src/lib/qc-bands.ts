/**
 * QC confidence banding.
 *
 * The legacy engine used a 3-band scale (high >= .9 / medium >= .7 / low).
 * The desk wants 4 bands, and the same four colors are reused for load urgency
 * so a color means the same thing everywhere in the product:
 *
 *   green   >= 90%   trust it
 *   yellow  75-89%   glance at it
 *   orange  50-74%   check it
 *   red     <= 49%   it's probably wrong / missing
 *
 * Thresholds live in `org_settings.qc_bands` so they can be tuned without a
 * deploy — these constants are only the fallback when settings haven't loaded.
 */

export type Band = 'green' | 'yellow' | 'orange' | 'red' | 'none'

export interface QcBandThresholds {
  green: number
  yellow: number
  orange: number
}

export const DEFAULT_QC_BANDS: QcBandThresholds = {
  green: 0.9,
  yellow: 0.75,
  orange: 0.5,
}

/**
 * Band a 0..1 confidence score. `null`/`undefined` confidence means the field
 * was never populated, which is reported as 'none' (rendered grey) rather than
 * as red — "we never saw this" and "we read it and don't trust it" are
 * different problems for the person doing QC.
 */
export function bandFor(
  confidence: number | null | undefined,
  thresholds: QcBandThresholds = DEFAULT_QC_BANDS,
): Band {
  if (confidence === null || confidence === undefined || Number.isNaN(confidence)) return 'none'
  if (confidence >= thresholds.green) return 'green'
  if (confidence >= thresholds.yellow) return 'yellow'
  if (confidence >= thresholds.orange) return 'orange'
  return 'red'
}

export const BAND_LABEL: Record<Band, string> = {
  green: 'High confidence',
  yellow: 'Check',
  orange: 'Low confidence',
  red: 'Missing or unreliable',
  none: 'Not found',
}

/** Tailwind classes per band. Kept in one place so pills/rows/dots stay consistent. */
export const BAND_CLASS: Record<Band, string> = {
  green: 'bg-band-green/15 text-emerald-300 border-band-green/40',
  yellow: 'bg-band-yellow/15 text-amber-300 border-band-yellow/40',
  orange: 'bg-band-orange/15 text-orange-300 border-band-orange/40',
  red: 'bg-band-red/15 text-red-300 border-band-red/40',
  none: 'bg-ink-800 text-slate-400 border-ink-600',
}

export const BAND_DOT_CLASS: Record<Band, string> = {
  green: 'bg-band-green',
  yellow: 'bg-band-yellow',
  orange: 'bg-band-orange',
  red: 'bg-band-red',
  none: 'bg-slate-600',
}

/** Sort order for "worst first" listings. */
export const BAND_SEVERITY: Record<Band, number> = {
  red: 4,
  orange: 3,
  yellow: 2,
  none: 1,
  green: 0,
}

export function formatConfidence(c: number | null | undefined): string {
  if (c === null || c === undefined || Number.isNaN(c)) return '—'
  return `${Math.round(c * 100)}%`
}
