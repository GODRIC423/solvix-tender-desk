import type { InvoiceStatus } from '@/types/db'

const STYLE: Record<InvoiceStatus, string> = {
  draft: 'border-ink-600 bg-ink-800 text-slate-300',
  sent: 'border-band-yellow/40 bg-band-yellow/15 text-amber-300',
  paid: 'border-band-green/40 bg-band-green/15 text-emerald-300',
  void: 'border-ink-700 bg-ink-900 text-slate-500 line-through',
}

export default function InvoiceStatusPill({ status }: { status: InvoiceStatus }) {
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase ${STYLE[status]}`}>
      {status}
    </span>
  )
}
