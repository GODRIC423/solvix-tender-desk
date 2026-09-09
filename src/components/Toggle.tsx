import type { ReactNode } from 'react'

/**
 * An iOS-style switch.
 *
 * The owner asked for it by name: "sliders and round buttons, colour-coded
 * on and off ... very easy for people to understand what you're doing."
 * So: a pill track that goes green when on, a knob that slides, and a label
 * beside it. Never a checkbox.
 *
 * `inherited` renders the switch dimmer to say "this value came from the
 * team/role default, nobody set it here" — the Users page relies on that to
 * separate deliberate grants from defaults.
 */
export default function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled = false,
  inherited = false,
  tone = 'green',
  size = 'md',
  id,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label?: ReactNode
  description?: ReactNode
  disabled?: boolean
  inherited?: boolean
  tone?: 'green' | 'accent' | 'amber' | 'red'
  size?: 'sm' | 'md'
  id?: string
}) {
  const onClass =
    tone === 'accent'
      ? 'bg-accent'
      : tone === 'amber'
        ? 'bg-band-yellow'
        : tone === 'red'
          ? 'bg-band-red'
          : 'bg-band-green'

  const track = size === 'sm' ? 'h-5 w-9' : 'h-6 w-11'
  const knob = size === 'sm' ? 'h-4 w-4' : 'h-5 w-5'
  const travel = size === 'sm' ? 'translate-x-4' : 'translate-x-5'

  const control = (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-ink-900 disabled:cursor-not-allowed ${track} ${
        checked ? onClass : 'bg-ink-600'
      } ${disabled ? 'opacity-40' : inherited ? 'opacity-70' : ''}`}
    >
      <span
        aria-hidden="true"
        className={`pointer-events-none inline-block transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${knob} ${
          checked ? travel : 'translate-x-0'
        }`}
      />
    </button>
  )

  if (!label && !description) return control

  return (
    <label
      className={`flex items-start gap-3 ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
      onClick={(e) => {
        // The button handles its own click; stop the label from double-firing.
        if ((e.target as HTMLElement).closest('button')) return
        if (!disabled) onChange(!checked)
      }}
    >
      {control}
      <span className="min-w-0 flex-1 select-none">
        {label && <span className="block text-sm font-medium text-slate-200">{label}</span>}
        {description && <span className="block text-xs text-slate-500">{description}</span>}
      </span>
    </label>
  )
}

/** A row of label + toggle, right-aligned — the layout Settings uses everywhere. */
export function ToggleRow({
  label,
  description,
  checked,
  onChange,
  disabled,
  inherited,
  tone,
  children,
}: {
  label: ReactNode
  description?: ReactNode
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
  inherited?: boolean
  tone?: 'green' | 'accent' | 'amber' | 'red'
  /** Extra controls (an hours input, say) rendered between label and switch. */
  children?: ReactNode
}) {
  return (
    <div className="flex items-center gap-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="text-sm text-slate-200">{label}</div>
        {description && <div className="text-xs text-slate-500">{description}</div>}
      </div>
      {children}
      <Toggle
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        inherited={inherited}
        tone={tone}
      />
    </div>
  )
}
