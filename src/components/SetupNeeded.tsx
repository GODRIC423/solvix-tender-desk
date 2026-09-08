/**
 * Shown when the app hasn't been pointed at a Supabase project yet. A fresh
 * clone should explain itself rather than throwing network errors.
 */
export default function SetupNeeded() {
  return (
    <div className="mx-auto flex min-h-full max-w-2xl flex-col justify-center gap-4 p-8">
      <h1 className="text-xl font-semibold text-slate-100">Finish connecting the desk</h1>
      <p className="text-sm text-slate-300">
        This build isn&apos;t pointed at a Supabase project yet, so there&apos;s nothing to log in
        to. Create a project, run the migrations in <code className="text-accent">supabase/</code>,
        then set these and rebuild:
      </p>
      <pre className="card overflow-x-auto p-4 text-xs text-slate-300">
        {`VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key>`}
      </pre>
      <p className="text-sm text-slate-400">
        Full walkthrough is in <code className="text-accent">DEPLOY.md</code>.
      </p>
    </div>
  )
}
