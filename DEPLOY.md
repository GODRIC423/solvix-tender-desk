# Deploying Solvix Tender Desk

Supersedes `legacy/PUBLISH_STEPS.md`, which described hand-uploading flat files
to GitHub Pages. The desk now has a database and a build step, so it deploys
differently.

Two pieces:

| Piece | Runs on | What it is |
|---|---|---|
| Database, auth, file storage, ingest API | Supabase | Postgres + Auth + Storage + one Edge Function |
| The web app + the connector | Cloudflare Pages (or Netlify/Vercel) | static build output from Vite |

---

## 1. Supabase project

1. Create a project at <https://supabase.com>. Note the project URL and the
   **anon** key (Settings → API).
2. Install the CLI and link the project:
   ```bash
   npm install -g supabase
   supabase login
   supabase link --project-ref <your-project-ref>
   ```
3. Push the schema:
   ```bash
   supabase db push
   ```
   This creates every table, the RLS policies, the views the app queries, and
   seeds the lookup tables (pipeline stages, waiting-on flags, interaction
   types, metros).
4. Deploy the ingest function and give it a token the connector will use:
   ```bash
   supabase secrets set INGEST_TOKEN="$(openssl rand -hex 24)"
   supabase functions deploy ingest-load
   ```
   Keep that token — you paste it into the connector once per browser.

### Creating users

Signup is deliberately admin-only; there is no self-serve registration. Add
dispatchers in the Supabase dashboard (Authentication → Users → Add user), then
set their role:

```sql
update profiles set role = 'admin', full_name = 'Your Name'
where email = 'you@example.com';
```

Roles are `admin`, `dispatcher`, `viewer`. Only `admin` can edit org settings or
delete loads.

---

## 2. The web app

```bash
cp .env.example .env      # fill in the three values
npm install
npm run dev               # http://localhost:5173
```

Build output goes to `dist/`:

```bash
npm run build             # typechecks, then builds
npm run preview           # serve the build locally
```

### Cloudflare Pages

1. Connect the GitHub repo.
2. Build command `npm run build`, output directory `dist`.
3. Add the three `VITE_*` variables from `.env` as environment variables.
4. Add an SPA fallback so deep links survive a refresh — Cloudflare Pages does
   this automatically for `dist/index.html`; on Netlify add `_redirects` with
   `/*  /index.html  200`.

The connector is built alongside the app and served at `/connector/`.

> **Note on GitHub Pages:** the old site was served from the repo root. Now that
> the app needs a build step and client-side routing, GitHub Pages would need a
> Actions workflow plus a `404.html` fallback hack. The legacy single-file tool
> still works standalone at `legacy/index.html` if you need it during the
> transition.

---

## 3. Verifying it works end to end

1. Sign in at `/login`.
2. Open `/connector/`, paste the ingest token, drop a tender PDF or scan.
   Extraction runs in the browser; confidence pills appear per field.
3. Click **Send to TMS** — you should get back a load number.
4. That load appears on the board in **QC Review**, colored by how soon it
   ships, with its QC score banded green/yellow/orange/red.
5. Open it, correct any orange/red fields, log a check call, set a
   "waiting on" flag, and move it through stages.
6. Open the board in a second browser — changes should appear live
   (Supabase Realtime).

The two sample tenders embedded in `legacy/index.html` are useful fixtures for
this walkthrough.

---

## 4. Configuration you can change without a deploy

Settings → thresholds are stored in the `org_settings` table and read at
runtime:

- **QC bands** — green/yellow/orange cutoffs.
- **Urgency (unbooked)** — hours-to-pickup at which an uncovered load turns
  yellow / orange / red.
- **Urgency (booked)** — how close to pickup a load with no check call turns
  orange/red, and how long before an untouched load goes yellow.
- **Carrier note aging** — how long a note counts as "recent" (shown
  automatically) versus "caution" (badge on the interactions tab).

These defaults are a starting point, not a recommendation — expect to tune the
hour cutoffs after a couple of weeks of real dispatching.
