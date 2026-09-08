import {
  BAND_CLASS,
  BAND_DOT_CLASS,
  BAND_LABEL,
  bandFor,
  formatConfidence,
  type Band,
  type QcBandThresholds,
} from '@/lib/qc-bands'

export function BandPill({
  confidence,
  thresholds,
  showPercent = true,
  className = '',
}: {
  confidence: number | null | undefined
  thresholds?: QcBandThresholds
  showPercent?: boolean
  className?: string
}) {
  const band = bandFor(confidence, thresholds)
  return (
    <span
      title={BAND_LABEL[band]}
      className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${BAND_CLASS[band]} ${className}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${BAND_DOT_CLASS[band]}`} />
      {showPercent ? formatConfidence(confidence) : BAND_LABEL[band]}
    </span>
  )
}

export function BandDot({ band, title }: { band: Band; title?: string }) {
  return (
    <span
      title={title ?? BAND_LABEL[band]}
      className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${BAND_DOT_CLASS[band]}`}
    />
  )
}

/** Overall load QC score, with the band spelled out — used in headers. */
export function QcScoreBadge({
  score,
  thresholds,
}: {
  score: number | null | undefined
  thresholds?: QcBandThresholds
}) {
  const band = bandFor(score, thresholds)
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-semibold ${BAND_CLASS[band]}`}
    >
      <span className={`h-2 w-2 rounded-full ${BAND_DOT_CLASS[band]}`} />
      QC {formatConfidence(score)}
      <span className="font-normal opacity-80">· {BAND_LABEL[band]}</span>
    </span>
  )
}
