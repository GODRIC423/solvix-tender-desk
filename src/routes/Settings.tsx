import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { useSettings } from '@/hooks/useSettings'
import { DEFAULT_QC_BANDS } from '@/lib/qc-bands'
import { DEFAULT_URGENCY_RULES } from '@/lib/urgency'

/**
 * Every threshold the board and QC screen use is editable here rather than
 * hardcoded — the exact hour cutoffs are the kind of thing that only gets right
 * after a few weeks of real dispatching.
 */
export default function Settings() {
  const { isAdmin } = useAuth()
  const { data: settings } = useSettings()
  const qc = useQueryClient()

  const [qcBands, setQcBands] = useState(settings?.qcBands ?? DEFAULT_QC_BANDS)
  const [urgency, setUrgency] = useState(settings?.urgencyRules ?? DEFAULT_URGENCY_RULES)
  const [aging, setAging] = useState(settings?.interactionAging ?? { recent_days: 30, caution_days: 365 })

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('org_settings')
        .update({
          qc_bands: qcBands,
          urgency_rules: urgency,
          interaction_aging: aging,
        })
        .eq('id', 1)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['org_settings'] }),
  })

  return (
    <div className="p-4">
      <h1 className="mb-3 text-lg font-semibold text-slate-100">Settings</h1>

      {!isAdmin && (
        <div className="card mb-4 border-band-yellow/40 bg-band-yellow/10 p-3 text-sm text-amber-200">
          These are read-only for your role — an admin can change them.
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="card p-3">
          <h2 className="mb-1 text-sm font-semibold text-slate-200">QC confidence bands</h2>
          <p className="mb-3 text-xs text-slate-500">
            Applied to each field and to the load&apos;s overall score. Anything below the orange
            cutoff shows red.
          </p>
          {(
            [
              ['green', 'Green at or above'],
              ['yellow', 'Yellow at or above'],
              ['orange', 'Orange at or above'],
            ] as const
          ).map(([key, label]) => (
            <div key={key} className="mb-2">
              <label className="label">{label}</label>
              <input
                className="input"
                type="number"
                step="0.01"
                min="0"
                max="1"
                disabled={!isAdmin}
                value={qcBands[key]}
                onChange={(e) => setQcBands({ ...qcBands, [key]: Number(e.target.value) })}
              />
            </div>
          ))}
        </section>

        <section className="card p-3">
          <h2 className="mb-1 text-sm font-semibold text-slate-200">Urgency — unbooked</h2>
          <p className="mb-3 text-xs text-slate-500">
            Hours until pickup at which an uncovered load changes color.
          </p>
          {(
            [
              ['yellow_hours', 'Yellow within (hours)'],
              ['orange_hours', 'Orange within (hours)'],
              ['red_hours', 'Red within (hours)'],
            ] as const
          ).map(([key, label]) => (
            <div key={key} className="mb-2">
              <label className="label">{label}</label>
              <input
                className="input"
                type="number"
                disabled={!isAdmin}
                value={urgency.unbooked[key]}
                onChange={(e) =>
                  setUrgency({
                    ...urgency,
                    unbooked: { ...urgency.unbooked, [key]: Number(e.target.value) },
                  })
                }
              />
            </div>
          ))}
        </section>

        <section className="card p-3">
          <h2 className="mb-1 text-sm font-semibold text-slate-200">Urgency — booked</h2>
          <p className="mb-3 text-xs text-slate-500">
            Once a carrier is on the load, color is driven by whether anyone has checked on it.
          </p>
          {(
            [
              ['red_hours_no_checkcall', 'Red: pickup within (hours) & no check call'],
              ['orange_hours_no_checkcall', 'Orange: pickup within (hours) & no check call'],
              ['stale_touch_hours', 'Yellow: untouched for (hours)'],
            ] as const
          ).map(([key, label]) => (
            <div key={key} className="mb-2">
              <label className="label">{label}</label>
              <input
                className="input"
                type="number"
                disabled={!isAdmin}
                value={urgency.booked[key]}
                onChange={(e) =>
                  setUrgency({
                    ...urgency,
                    booked: { ...urgency.booked, [key]: Number(e.target.value) },
                  })
                }
              />
            </div>
          ))}
        </section>

        <section className="card p-3">
          <h2 className="mb-1 text-sm font-semibold text-slate-200">Carrier note aging</h2>
          <p className="mb-3 text-xs text-slate-500">
            How long a note stays &quot;recent&quot; (shown automatically) and how long it keeps a
            caution marker.
          </p>
          <div className="mb-2">
            <label className="label">Recent window (days)</label>
            <input
              className="input"
              type="number"
              disabled={!isAdmin}
              value={aging.recent_days}
              onChange={(e) => setAging({ ...aging, recent_days: Number(e.target.value) })}
            />
          </div>
          <div className="mb-2">
            <label className="label">Caution window (days)</label>
            <input
              className="input"
              type="number"
              disabled={!isAdmin}
              value={aging.caution_days}
              onChange={(e) => setAging({ ...aging, caution_days: Number(e.target.value) })}
            />
          </div>
        </section>
      </div>

      {isAdmin && (
        <div className="mt-4 flex items-center gap-3">
          <button className="btn btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? 'Saving…' : 'Save settings'}
          </button>
          {save.isSuccess && <span className="text-xs text-emerald-300">Saved.</span>}
          {save.error && (
            <span className="text-xs text-red-300">{(save.error as Error).message}</span>
          )}
        </div>
      )}
    </div>
  )
}
