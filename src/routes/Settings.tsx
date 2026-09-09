import { useEffect, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { useSaveSettings, useSettings, type InteractionAging } from '@/hooks/useSettings'
import { DEFAULT_QC_BANDS, type QcBandThresholds } from '@/lib/qc-bands'
import { DEFAULT_FLAG_RULES, type FlagRules, type FlagTier } from '@/lib/urgency'
import { TEAM_SUGGESTIONS, teamLabel } from '@/lib/permissions'
import Toggle, { ToggleRow } from '@/components/Toggle'
import type { ViewPrefs } from '@/types/db'

/**
 * Every threshold the board and QC screen use is editable here rather than
 * hardcoded — the exact hour cutoffs are the kind of thing that only gets
 * right after a few weeks of real dispatching.
 *
 * Laid out the way the owner reads it: flags first (that is what the board
 * colours by), then who sees which flags, then the QC bands with an actual
 * explanation of what they are — that section was confused for the urgency
 * one on first use, which is why each card now opens with a sentence saying
 * what it controls.
 */
export default function Settings() {
  const { can } = useAuth()
  const editable = can('manage_settings')
  const { data: settings, isLoading } = useSettings()
  const save = useSaveSettings()

  const [flags, setFlags] = useState<FlagRules>(DEFAULT_FLAG_RULES)
  const [qc, setQc] = useState<QcBandThresholds>(DEFAULT_QC_BANDS)
  const [aging, setAging] = useState<InteractionAging>({ recent_days: 30, caution_days: 365 })
  const [teams, setTeams] = useState<Record<string, ViewPrefs>>({})
  const [cash, setCash] = useState<string>('')
  const [overhead, setOverhead] = useState<string>('')
  const [dirty, setDirty] = useState(false)

  // Seed the form once settings arrive (and again if they change underneath
  // us while nothing is being edited).
  useEffect(() => {
    if (!settings || dirty) return
    setFlags(settings.flagRules)
    setQc(settings.qcBands)
    setAging(settings.interactionAging)
    setTeams(settings.teamDefaults)
    setCash(settings.financials.cash_on_hand?.toString() ?? '')
    setOverhead(settings.financials.monthly_overhead?.toString() ?? '')
  }, [settings, dirty])

  function touch<T>(setter: (v: T) => void) {
    return (v: T) => {
      setter(v)
      setDirty(true)
    }
  }

  const setFlagsT = touch(setFlags)
  const setQcT = touch(setQc)
  const setAgingT = touch(setAging)
  const setTeamsT = touch(setTeams)

  function onSave() {
    save.mutate(
      {
        flag_rules: flags,
        qc_bands: qc,
        interaction_aging: aging,
        team_defaults: teams,
        cash_on_hand: cash.trim() === '' ? null : Number(cash),
        monthly_overhead: overhead.trim() === '' ? null : Number(overhead),
      },
      { onSuccess: () => setDirty(false) },
    )
  }

  if (isLoading) return <div className="p-6 text-sm text-slate-400">Loading settings…</div>

  return (
    <div className="p-4">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold text-slate-100">Settings</h1>
        {editable && (
          <div className="ml-auto flex items-center gap-3">
            {dirty && <span className="text-xs text-amber-300">Unsaved changes</span>}
            <button
              className="btn btn-primary"
              disabled={save.isPending || !dirty}
              onClick={onSave}
            >
              {save.isPending ? 'Saving…' : 'Save settings'}
            </button>
          </div>
        )}
      </div>

      {!editable && (
        <div className="card mb-4 border-band-yellow/40 bg-band-yellow/10 p-3 text-sm text-amber-200">
          These are read-only for your role — an admin can change them. Your own board view is
          under the <span className="font-medium">View</span> switches on the load board.
        </div>
      )}

      {save.error && (
        <div className="card mb-4 border-band-red/40 bg-band-red/10 p-3 text-sm text-red-300">
          Couldn&apos;t save: {(save.error as Error).message}
        </div>
      )}
      {save.isSuccess && !dirty && (
        <div className="mb-4 text-xs text-emerald-300">Saved.</div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ------------------------------------------------ unbooked flags */}
        <Card
          title="Flags — loads with no carrier yet"
          explain="A load nobody has covered turns colour as its pickup gets closer. Each colour is a switch with an hour cutoff behind it. Switch a colour off and loads fall through to the next one down."
        >
          <Toggle
            checked={flags.unbooked.enabled}
            disabled={!editable}
            onChange={(v) => setFlagsT({ ...flags, unbooked: { ...flags.unbooked, enabled: v } })}
            label="Flag unbooked loads"
            description="Master switch. Off means no unbooked load gets a colour, whatever the clock says."
          />
          <div className="mt-2 divide-y divide-ink-800 border-t border-ink-800">
            <TierRow
              color="yellow"
              label="Yellow"
              description="Pickup is within this many hours"
              tier={flags.unbooked.yellow}
              disabled={!editable || !flags.unbooked.enabled}
              onChange={(t) => setFlagsT({ ...flags, unbooked: { ...flags.unbooked, yellow: t } })}
            />
            <TierRow
              color="orange"
              label="Orange"
              description="Pickup is within this many hours — needs covering"
              tier={flags.unbooked.orange}
              disabled={!editable || !flags.unbooked.enabled}
              onChange={(t) => setFlagsT({ ...flags, unbooked: { ...flags.unbooked, orange: t } })}
            />
            <TierRow
              color="red"
              label="Red"
              description="Pickup is within this many hours, or already missed"
              tier={flags.unbooked.red}
              disabled={!editable || !flags.unbooked.enabled}
              onChange={(t) => setFlagsT({ ...flags, unbooked: { ...flags.unbooked, red: t } })}
            />
          </div>
        </Card>

        {/* -------------------------------------------------- booked flags */}
        <Card
          title="Flags — booked loads"
          explain="Once a carrier is on the load, the clock alone isn't the story. What matters is whether someone has checked on it. These fire when nobody has."
        >
          <Toggle
            checked={flags.booked.enabled}
            disabled={!editable}
            onChange={(v) => setFlagsT({ ...flags, booked: { ...flags.booked, enabled: v } })}
            label="Flag booked loads"
            description="Master switch for everything below."
          />
          <div className="mt-2 divide-y divide-ink-800 border-t border-ink-800">
            <TierRow
              color="red"
              label="Red — no check call"
              description="Pickup within this many hours and no check call ever logged"
              tier={flags.booked.red_no_checkcall}
              disabled={!editable || !flags.booked.enabled}
              onChange={(t) =>
                setFlagsT({ ...flags, booked: { ...flags.booked, red_no_checkcall: t } })
              }
            />
            <TierRow
              color="orange"
              label="Orange — no check call"
              description="Pickup within this many hours and no check call yet"
              tier={flags.booked.orange_no_checkcall}
              disabled={!editable || !flags.booked.enabled}
              onChange={(t) =>
                setFlagsT({ ...flags, booked: { ...flags.booked, orange_no_checkcall: t } })
              }
            />
            <TierRow
              color="yellow"
              label="Yellow — gone quiet"
              description="Nobody has touched the load for this many hours"
              tier={flags.booked.stale}
              disabled={!editable || !flags.booked.enabled}
              onChange={(t) => setFlagsT({ ...flags, booked: { ...flags.booked, stale: t } })}
            />
          </div>
        </Card>

        {/* -------------------------------------------------- team defaults */}
        <Card
          title="Who sees which loads"
          explain="Defaults by team. The check-call team calls drivers on booked loads and has no use for the unbooked board, so theirs is off. Each person can narrow their own view further from the board; an admin can set it per user on the Users page."
        >
          <div className="divide-y divide-ink-800">
            {teamKeys(teams).map((key) => {
              const t = teams[key] ?? {}
              return (
                <div key={key} className="py-2">
                  <div className="mb-1 text-sm font-medium text-slate-200">{teamLabel(key)}</div>
                  <div className="grid gap-x-6 sm:grid-cols-2">
                    <ToggleRow
                      label="Unbooked loads"
                      checked={t.show_unbooked ?? true}
                      disabled={!editable}
                      onChange={(v) =>
                        setTeamsT({
                          ...teams,
                          [key]: {
                            ...t,
                            show_unbooked: v,
                            flags: { ...t.flags, unbooked: { ...t.flags?.unbooked, enabled: v } },
                          },
                        })
                      }
                    />
                    <ToggleRow
                      label="Booked loads"
                      checked={t.show_booked ?? true}
                      disabled={!editable}
                      onChange={(v) =>
                        setTeamsT({
                          ...teams,
                          [key]: {
                            ...t,
                            show_booked: v,
                            flags: { ...t.flags, booked: { ...t.flags?.booked, enabled: v } },
                          },
                        })
                      }
                    />
                  </div>
                </div>
              )
            })}
          </div>
          <p className="mt-2 text-[11px] text-slate-500">
            Teams are set per user on the Users page. A team that isn&apos;t listed here sees
            everything.
          </p>
        </Card>

        {/* ----------------------------------------------------- QC bands */}
        <Card
          title="Reading confidence (QC)"
          explain={
            <>
              <span className="font-medium text-slate-300">What is this?</span> When a tender is
              dropped in, the reader scores how sure it is about each value it pulled out — a
              rate it read cleanly scores high, a smudged zip code scores low. These cutoffs decide
              which colour each field and the load&apos;s overall QC score get. It is about how
              well the document was <em>read</em>, not about the load being late — that is Flags,
              above.
            </>
          }
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <PercentInput
              label="Green at or above"
              hint="Trust it"
              value={qc.green}
              disabled={!editable}
              onChange={(v) => setQcT({ ...qc, green: v })}
            />
            <PercentInput
              label="Yellow at or above"
              hint="Glance at it"
              value={qc.yellow}
              disabled={!editable}
              onChange={(v) => setQcT({ ...qc, yellow: v })}
            />
            <PercentInput
              label="Orange at or above"
              hint="Check it — below this is red"
              value={qc.orange}
              disabled={!editable}
              onChange={(v) => setQcT({ ...qc, orange: v })}
            />
          </div>
        </Card>

        {/* ---------------------------------------------- carrier aging */}
        <Card
          title="Carrier note aging"
          explain="How long a note about a carrier stays front and centre. Recent notes pop up the moment the carrier is opened; older ones sit behind a caution badge until they age out."
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <NumberInput
              label="Recent window (days)"
              value={aging.recent_days}
              disabled={!editable}
              onChange={(v) => setAgingT({ ...aging, recent_days: v })}
            />
            <NumberInput
              label="Caution window (days)"
              value={aging.caution_days}
              disabled={!editable}
              onChange={(v) => setAgingT({ ...aging, caution_days: v })}
            />
          </div>
        </Card>

        {/* -------------------------------------------------- financials */}
        <Card
          title="Reports inputs"
          explain="Two numbers the reports page can't get from loads. Runway = cash on hand ÷ (monthly overhead − monthly gross profit). Leave them blank to hide the runway tile."
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label">Cash on hand ($)</label>
              <input
                className="input"
                type="number"
                min="0"
                step="100"
                disabled={!editable}
                value={cash}
                onChange={(e) => {
                  setCash(e.target.value)
                  setDirty(true)
                }}
                placeholder="e.g. 85000"
              />
            </div>
            <div>
              <label className="label">Monthly overhead ($)</label>
              <input
                className="input"
                type="number"
                min="0"
                step="100"
                disabled={!editable}
                value={overhead}
                onChange={(e) => {
                  setOverhead(e.target.value)
                  setDirty(true)
                }}
                placeholder="payroll, software, insurance…"
              />
              <p className="mt-1 text-[11px] text-slate-500">
                Fixed costs only. Carrier pay is already netted out of load margin.
              </p>
            </div>
          </div>
        </Card>
      </div>
    </div>
  )
}

function teamKeys(teams: Record<string, ViewPrefs>): string[] {
  const keys = new Set<string>(TEAM_SUGGESTIONS.map((t) => t.key))
  Object.keys(teams).forEach((k) => keys.add(k))
  return [...keys]
}

function Card({
  title,
  explain,
  children,
}: {
  title: string
  explain?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="card p-3">
      <h2 className="mb-1 text-sm font-semibold text-slate-200">{title}</h2>
      {explain && <p className="mb-3 text-xs leading-relaxed text-slate-500">{explain}</p>}
      {children}
    </section>
  )
}

const DOT: Record<'yellow' | 'orange' | 'red', string> = {
  yellow: 'bg-band-yellow',
  orange: 'bg-band-orange',
  red: 'bg-band-red',
}

/** One flag tier: colour dot, label, hours input, switch. */
function TierRow({
  color,
  label,
  description,
  tier,
  disabled,
  onChange,
}: {
  color: 'yellow' | 'orange' | 'red'
  label: string
  description: string
  tier: FlagTier
  disabled: boolean
  onChange: (next: FlagTier) => void
}) {
  return (
    <ToggleRow
      label={
        <span className="inline-flex items-center gap-2">
          <span className={`h-2.5 w-2.5 rounded-full ${DOT[color]}`} />
          {label}
        </span>
      }
      description={description}
      checked={tier.enabled}
      disabled={disabled}
      onChange={(enabled) => onChange({ ...tier, enabled })}
      tone={color === 'red' ? 'red' : color === 'orange' ? 'amber' : 'green'}
    >
      <div className="flex items-center gap-1 text-xs text-slate-400">
        <input
          className="input w-16 text-right"
          type="number"
          min="0"
          step="1"
          disabled={disabled || !tier.enabled}
          value={tier.hours}
          onChange={(e) => onChange({ ...tier, hours: Number(e.target.value) })}
        />
        h
      </div>
    </ToggleRow>
  )
}

/** Stored 0..1, shown 0..100 — nobody thinks in "0.75". */
function PercentInput({
  label,
  hint,
  value,
  disabled,
  onChange,
}: {
  label: string
  hint: string
  value: number
  disabled: boolean
  onChange: (v: number) => void
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <div className="flex items-center gap-1">
        <input
          className="input"
          type="number"
          min="0"
          max="100"
          step="1"
          disabled={disabled}
          value={Math.round(value * 100)}
          onChange={(e) => onChange(Math.min(100, Math.max(0, Number(e.target.value))) / 100)}
        />
        <span className="text-sm text-slate-400">%</span>
      </div>
      <p className="mt-1 text-[11px] text-slate-500">{hint}</p>
    </div>
  )
}

function NumberInput({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string
  value: number
  disabled: boolean
  onChange: (v: number) => void
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <input
        className="input"
        type="number"
        min="0"
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  )
}
