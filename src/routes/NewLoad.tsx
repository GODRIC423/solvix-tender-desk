import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { useCreateLoad, type ManualLoadInput, type ManualStopInput } from '@/hooks/useLoads'
import { useCustomerSearch } from '@/hooks/useCustomers'
import { useCarrierSearch } from '@/hooks/useCarriers'
import { makeSampleLoad } from '@/lib/sample-load'
import StopForm, { emptyStop } from '@/components/StopForm'
import Toggle from '@/components/Toggle'

const EQUIPMENT = [
  'Dry van 53ft',
  'Dry van 48ft',
  'Reefer 53ft',
  'Flatbed 48ft',
  'Flatbed 53ft',
  'Step deck',
  'Power only',
  'Box truck',
  'Sprinter',
]

/**
 * Add a load by hand.
 *
 * Before this the only way a load existed was to drop a tender into the
 * connector. That's fine for the ones that come in as documents; it's
 * useless for the phone call that says "can you cover this tomorrow?" — and
 * it meant there was no way to make a throwaway load to click around in.
 */
export default function NewLoad() {
  const navigate = useNavigate()
  const { can } = useAuth()
  const create = useCreateLoad()

  const [load, setLoad] = useState<ManualLoadInput>({
    stage_key: 'available',
    weight_uom: 'L',
    currency: 'USD',
    hazmat: false,
    is_test: false,
  })
  const [stops, setStops] = useState<ManualStopInput[]>([emptyStop('pickup'), emptyStop('delivery')])

  if (!can('create_loads')) {
    return (
      <div className="p-6">
        <div className="card border-band-yellow/40 bg-band-yellow/10 p-3 text-sm text-amber-200">
          Your account can&apos;t create loads. An admin can turn that on under Users.
        </div>
      </div>
    )
  }

  const set = (k: keyof ManualLoadInput, v: unknown) => setLoad({ ...load, [k]: v })
  const num = (k: keyof ManualLoadInput) => (e: React.ChangeEvent<HTMLInputElement>) =>
    set(k, e.target.value === '' ? null : Number(e.target.value))
  const text = (k: keyof ManualLoadInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    set(k, e.target.value === '' ? null : e.target.value)

  const margin =
    load.customer_rate != null && load.carrier_rate != null ? load.customer_rate - load.carrier_rate : null

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const res = await create.mutateAsync({ load, stops })
    navigate(`/loads/${res.load_id}`)
  }

  async function makeTestLoad() {
    const sample = makeSampleLoad()
    const res = await create.mutateAsync(sample)
    navigate(`/loads/${res.load_id}`)
  }

  function fillFromSample() {
    const sample = makeSampleLoad()
    setLoad({ ...sample.load, is_test: load.is_test })
    setStops(sample.stops)
  }

  return (
    <form className="p-4" onSubmit={submit}>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Link to="/loads" className="text-sm text-slate-400 hover:text-slate-200">
          ← Board
        </Link>
        <h1 className="text-lg font-semibold text-slate-100">New load</h1>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            className="btn text-xs"
            onClick={makeTestLoad}
            disabled={create.isPending}
            title="Creates a realistic throwaway load straight away and opens it"
          >
            Create a test load
          </button>
          <button type="button" className="btn text-xs" onClick={fillFromSample} title="Fill this form with sample values you can edit first">
            Fill with sample
          </button>
        </div>
      </div>

      {create.error && (
        <div className="card mb-4 border-band-red/40 bg-band-red/10 p-3 text-sm text-red-300">
          {(create.error as Error).message}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {/* -------------------------------------------------------- stops */}
          <section className="card p-3">
            <div className="mb-2 flex items-center gap-2">
              <h2 className="text-sm font-semibold text-slate-200">Stops</h2>
              <span className="text-xs text-slate-500">
                Times are the time on the dock&apos;s clock — the desk works out the zone from the city.
              </span>
            </div>
            <div className="space-y-3">
              {stops.map((stop, i) => (
                <div key={i} className="rounded border border-ink-700 bg-ink-850 p-3">
                  <div className="mb-2 flex items-center gap-2">
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                        stop.stop_type === 'pickup'
                          ? 'bg-sky-500/15 text-sky-300'
                          : stop.stop_type === 'delivery'
                            ? 'bg-emerald-500/15 text-emerald-300'
                            : 'bg-ink-700 text-slate-300'
                      }`}
                    >
                      Stop {i + 1}
                    </span>
                    <div className="ml-auto flex gap-1">
                      {i > 0 && (
                        <button
                          type="button"
                          className="btn text-xs"
                          onClick={() => {
                            const next = [...stops]
                            ;[next[i - 1], next[i]] = [next[i], next[i - 1]]
                            setStops(next)
                          }}
                        >
                          ↑
                        </button>
                      )}
                      {i < stops.length - 1 && (
                        <button
                          type="button"
                          className="btn text-xs"
                          onClick={() => {
                            const next = [...stops]
                            ;[next[i + 1], next[i]] = [next[i], next[i + 1]]
                            setStops(next)
                          }}
                        >
                          ↓
                        </button>
                      )}
                      {stops.length > 1 && (
                        <button
                          type="button"
                          className="btn btn-danger text-xs"
                          onClick={() => setStops(stops.filter((_, j) => j !== i))}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </div>
                  <StopForm value={stop} onChange={(s) => setStops(stops.map((x, j) => (j === i ? s : x)))} />
                </div>
              ))}
            </div>
            <div className="mt-2 flex gap-2">
              <button type="button" className="btn text-xs" onClick={() => setStops([...stops, emptyStop('pickup')])}>
                + Pickup
              </button>
              <button type="button" className="btn text-xs" onClick={() => setStops([...stops, emptyStop('delivery')])}>
                + Delivery
              </button>
            </div>
          </section>

          {/* ------------------------------------------------------ freight */}
          <section className="card p-3">
            <h2 className="mb-2 text-sm font-semibold text-slate-200">Freight &amp; equipment</h2>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="sm:col-span-2">
                <label className="label">Commodity</label>
                <input className="input" value={load.commodity ?? ''} onChange={text('commodity')} placeholder="e.g. Frozen poultry, 22 pallets" />
              </div>
              <div>
                <label className="label">Equipment</label>
                <input className="input" list="equipment-suggestions" value={load.equipment_type_text ?? ''} onChange={text('equipment_type_text')} />
                <datalist id="equipment-suggestions">
                  {EQUIPMENT.map((e) => (
                    <option key={e} value={e} />
                  ))}
                </datalist>
              </div>
              <div>
                <label className="label">Weight (lb)</label>
                <input className="input" type="number" min="0" value={load.total_weight ?? ''} onChange={num('total_weight')} />
              </div>
              <div>
                <label className="label">Pieces / pallets</label>
                <input className="input" type="number" min="0" value={load.total_quantity ?? ''} onChange={num('total_quantity')} />
              </div>
              <div>
                <label className="label">Miles</label>
                <input className="input" type="number" min="0" value={load.distance_miles ?? ''} onChange={num('distance_miles')} />
              </div>
              <div>
                <label className="label">Temp min (°F)</label>
                <input className="input" type="number" value={load.temp_min ?? ''} onChange={num('temp_min')} />
              </div>
              <div>
                <label className="label">Temp max (°F)</label>
                <input className="input" type="number" value={load.temp_max ?? ''} onChange={num('temp_max')} />
              </div>
              <div className="flex items-end pb-1">
                <Toggle checked={Boolean(load.hazmat)} onChange={(v) => set('hazmat', v)} label="Hazmat" tone="red" />
              </div>
            </div>
          </section>

          <section className="card p-3">
            <h2 className="mb-2 text-sm font-semibold text-slate-200">Notes</h2>
            <textarea
              className="input min-h-[80px]"
              value={load.notes ?? ''}
              onChange={text('notes')}
              placeholder="Anything the carrier needs to know: lumper, check-in, driver assist…"
            />
          </section>
        </div>

        {/* ----------------------------------------------------- side rail */}
        <div className="space-y-4">
          <section className="card p-3">
            <h2 className="mb-2 text-sm font-semibold text-slate-200">Who it&apos;s for</h2>
            <PartyPicker kind="customer" label="Customer" value={load.customer_id ?? null} onChange={(id) => set('customer_id', id)} />
            <div className="mt-3">
              <PartyPicker kind="carrier" label="Carrier (if already covered)" value={load.carrier_id ?? null} onChange={(id) => set('carrier_id', id)} />
            </div>
            <div className="mt-3">
              <label className="label">Customer&apos;s order / reference #</label>
              <input className="input" value={load.shipment_id ?? ''} onChange={text('shipment_id')} />
            </div>
          </section>

          <section className="card p-3">
            <h2 className="mb-2 text-sm font-semibold text-slate-200">Money</h2>
            <div className="space-y-3">
              <div>
                <label className="label">Customer rate ($)</label>
                <input className="input" type="number" min="0" step="0.01" value={load.customer_rate ?? ''} onChange={num('customer_rate')} />
              </div>
              <div>
                <label className="label">Carrier rate ($)</label>
                <input className="input" type="number" min="0" step="0.01" value={load.carrier_rate ?? ''} onChange={num('carrier_rate')} />
              </div>
              {margin !== null && (
                <div className={`text-sm ${margin < 0 ? 'text-red-300' : 'text-emerald-300'}`}>
                  Margin {margin.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
                  {load.customer_rate ? ` · ${Math.round((margin / load.customer_rate) * 100)}%` : ''}
                </div>
              )}
            </div>
          </section>

          <section className="card p-3">
            <h2 className="mb-2 text-sm font-semibold text-slate-200">Start it as</h2>
            <select className="input" value={load.stage_key} onChange={(e) => set('stage_key', e.target.value)}>
              <option value="available">Available — needs a carrier</option>
              <option value="booked">Booked — carrier already on it</option>
              <option value="new">New — still gathering details</option>
            </select>
            <div className="mt-3">
              <Toggle
                checked={Boolean(load.is_test)}
                onChange={(v) => set('is_test', v)}
                label="This is a test load"
                description="Wears a badge, stays out of reports, and you can delete it yourself."
                tone="amber"
              />
            </div>
          </section>

          <button className="btn btn-primary w-full justify-center" disabled={create.isPending}>
            {create.isPending ? 'Creating…' : 'Create load'}
          </button>
        </div>
      </div>
    </form>
  )
}

function PartyPicker({
  kind,
  label,
  value,
  onChange,
}: {
  kind: 'customer' | 'carrier'
  label: string
  value: string | null
  onChange: (id: string | null) => void
}) {
  const [q, setQ] = useState('')
  const customers = useCustomerSearch(kind === 'customer' ? q : '')
  const carriers = useCarrierSearch(kind === 'carrier' ? q : '')
  const options = (kind === 'customer' ? customers.data : carriers.data) ?? []
  const selected = options.find((o) => o.id === value)

  return (
    <div>
      <label className="label">{label}</label>
      {value && selected ? (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-slate-100">{selected.name}</span>
          <button type="button" className="text-xs text-slate-400 underline" onClick={() => onChange(null)}>
            change
          </button>
        </div>
      ) : (
        <>
          <input
            className="input"
            placeholder={kind === 'customer' ? 'Search customers…' : 'Search by DOT, MC, or name…'}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {q && (
            <ul className="mt-1 max-h-40 overflow-auto rounded border border-ink-700 bg-ink-900 text-sm">
              {options.length === 0 && <li className="px-2 py-1 text-slate-500">No matches</li>}
              {options.slice(0, 20).map((o) => (
                <li key={o.id}>
                  <button
                    type="button"
                    className="w-full px-2 py-1 text-left hover:bg-ink-800"
                    onClick={() => {
                      onChange(o.id)
                      setQ('')
                    }}
                  >
                    {o.name}
                    {'dot_number' in o && o.dot_number ? (
                      <span className="ml-2 text-xs text-slate-500">DOT {o.dot_number}</span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}
