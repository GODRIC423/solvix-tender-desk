import { useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { isSupabaseConfigured } from '@/lib/supabase'
import SetupNeeded from '@/components/SetupNeeded'

export default function Login() {
  const { session, signIn } = useAuth()
  const location = useLocation() as { state?: { from?: string } }
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (!isSupabaseConfigured) return <SetupNeeded />
  if (session) return <Navigate to={location.state?.from ?? '/loads'} replace />

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error } = await signIn(email, password)
    setError(error)
    setBusy(false)
  }

  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <form onSubmit={onSubmit} className="card w-full max-w-sm space-y-4 p-6">
        <div>
          <h1 className="text-lg font-semibold text-slate-100">Solvix Tender Desk</h1>
          <p className="mt-1 text-xs text-slate-400">
            Accounts are created by an admin — there is no self-serve signup.
          </p>
        </div>

        <div>
          <label className="label" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            className="input"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>

        <div>
          <label className="label" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            className="input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>

        {error && (
          <div className="rounded border border-band-red/40 bg-band-red/10 px-3 py-2 text-xs text-red-300">
            {error}
          </div>
        )}

        <button className="btn btn-primary w-full justify-center" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}
