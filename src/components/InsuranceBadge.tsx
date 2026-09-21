import { insuranceHealth, type InsuranceHealth } from '@/lib/documents/data'
import type { CarrierInsuranceStatus } from '@/types/db'

const STYLE: Record<InsuranceHealth, { cls: string; text: string; short: string; title: string }> = {
  none: {
    cls: 'border-ink-600 bg-ink-800 text-slate-400',
    text: 'No insurance on file',
    short: 'no ins.',
    title: 'No insurance policies recorded for this carrier',
  },
  expired: {
    cls: 'border-band-red/40 bg-band-red/15 text-red-300',
    text: 'Insurance expired',
    short: 'ins. expired',
    title: 'At least one policy has expired',
  },
  expiring: {
    cls: 'border-band-yellow/40 bg-band-yellow/15 text-amber-300',
    text: 'Insurance expiring',
    short: 'ins. expiring',
    title: 'A policy expires within 30 days',
  },
  ok: {
    cls: 'border-band-green/40 bg-band-green/15 text-emerald-300',
    text: 'Insured',
    short: 'insured',
    title: 'Every policy on file is current',
  },
}

/** "Can we put them on a load?" at a glance. */
export default function InsuranceBadge({
  status,
  compact = false,
}: {
  status: CarrierInsuranceStatus | null | undefined
  compact?: boolean
}) {
  const s = STYLE[insuranceHealth(status)]
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${s.cls}`} title={s.title}>
      {compact ? s.short : s.text}
    </span>
  )
}
