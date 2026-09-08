import type { ManualStopInput } from '@/hooks/useLoads'

/**
 * The fields of one stop, used both by the New Load form and by the
 * add/edit panels on the load screen. Times are entered as the time on the
 * dock's clock; the database reads them in the dock's zone once it knows the
 * city, so nothing here converts anything.
 */
export default function StopForm({
  value,
  onChange,
  compact = false,
}: {
  value: ManualStopInput
  onChange: (next: ManualStopInput) => void
  compact?: boolean
}) {
  const set = (k: keyof ManualStopInput, v: string) =>
    onChange({ ...value, [k]: v === '' ? null : v })

  return (
    <div className={`grid gap-2 ${compact ? 'sm:grid-cols-2' : 'sm:grid-cols-3'}`}>
      <div className="sm:col-span-2">
        <label className="label">Facility</label>
        <input
          className="input"
          placeholder="Shipper / receiver name"
          value={value.name ?? ''}
          onChange={(e) => set('name', e.target.value)}
        />
      </div>
      <div>
        <label className="label">Type</label>
        <select
          className="input"
          value={value.stop_type}
          onChange={(e) => onChange({ ...value, stop_type: e.target.value as ManualStopInput['stop_type'] })}
        >
          <option value="pickup">Pickup</option>
          <option value="delivery">Delivery</option>
          <option value="other">Other</option>
        </select>
      </div>

      <div className={compact ? 'sm:col-span-2' : 'sm:col-span-3'}>
        <label className="label">Address</label>
        <input
          className="input"
          value={value.address1 ?? ''}
          onChange={(e) => set('address1', e.target.value)}
        />
      </div>
      <div>
        <label className="label">City</label>
        <input className="input" value={value.city ?? ''} onChange={(e) => set('city', e.target.value)} />
      </div>
      <div>
        <label className="label">State</label>
        <input
          className="input uppercase"
          maxLength={2}
          value={value.state ?? ''}
          onChange={(e) => set('state', e.target.value.toUpperCase())}
        />
      </div>
      <div>
        <label className="label">Zip</label>
        <input className="input" value={value.postal ?? ''} onChange={(e) => set('postal', e.target.value)} />
      </div>

      <div>
        <label className="label">Appointment</label>
        <input
          className="input"
          type="datetime-local"
          value={value.appointment_local ?? ''}
          onChange={(e) => set('appointment_local', e.target.value)}
        />
        <p className="mt-0.5 text-[10px] text-slate-500">Dock local time</p>
      </div>
      <div>
        <label className="label">Window opens</label>
        <input
          className="input"
          type="datetime-local"
          value={value.earliest_local ?? ''}
          onChange={(e) => set('earliest_local', e.target.value)}
        />
      </div>
      <div>
        <label className="label">Window closes</label>
        <input
          className="input"
          type="datetime-local"
          value={value.latest_local ?? ''}
          onChange={(e) => set('latest_local', e.target.value)}
        />
      </div>

      <div>
        <label className="label">Contact</label>
        <input
          className="input"
          value={value.contact_name ?? ''}
          onChange={(e) => set('contact_name', e.target.value)}
        />
      </div>
      <div>
        <label className="label">Phone</label>
        <input className="input" value={value.phone ?? ''} onChange={(e) => set('phone', e.target.value)} />
      </div>
      <div>
        <label className="label">Appt #</label>
        <input
          className="input"
          value={value.appointment_number ?? ''}
          onChange={(e) => set('appointment_number', e.target.value)}
        />
      </div>

      <div className={compact ? 'sm:col-span-2' : 'sm:col-span-3'}>
        <label className="label">Instructions</label>
        <input
          className="input"
          placeholder="Check in at guard shack, live load, lumper…"
          value={value.instructions ?? ''}
          onChange={(e) => set('instructions', e.target.value)}
        />
      </div>
    </div>
  )
}

export function emptyStop(stop_type: ManualStopInput['stop_type']): ManualStopInput {
  return { stop_type }
}
