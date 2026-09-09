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
dispatchers in the Supabase dashboard (Authentication → Users → Add user). The
first admin has to be promoted by hand:

```sql
update profiles set role = 'admin', full_name = 'Your Name'
where email = 'you@example.com';
```

After that, everything about a user is managed on the app's **Users** page:
role, team, active, and per-person permission switches.

### Roles, permissions and teams

Roles are `admin`, `dispatcher`, `viewer`. Admins can do everything and cannot
be restricted. Dispatchers and viewers get a default permission set per role
(**Users → Role defaults**) which an admin can override per person — for
instance granting one dispatcher `export_carriers`.

The switches are real gates, not hidden buttons: bulk import, manual load
creation and stop editing go through database functions that check
`has_permission()` themselves, and a database trigger refuses any change to
`role`, `active`, `team` or `permissions` that does not come from an admin.

One honest limit: **export** is a UI-only gate. Any active member can already
read every carrier and customer row through the API (that is what the list
pages do), so hiding the Export button is a speed bump, not a wall. Making it
a wall would mean row-limiting reads for non-admins, which would break the
list pages. Worth knowing before you rely on it.

Teams (`dispatch`, `check_call`, `sales`, `billing`, or anything you type) pick
a default board view from **Settings → Who sees which loads**. The check-call
team, for example, sees only booked loads. Each person can narrow their own
view further from the switches on the load board.

### Applying later migrations

Anything added after the first setup — migration `20260101000007` onward —
applies the same way: `supabase db push` if the project is linked, or paste
the file into the SQL Editor. Migrations are numbered and must run in order.

### Doing all of that without the CLI

Everything above can be done from the Supabase dashboard instead, which is worth
knowing if the person standing the project up does not have a terminal — or is
handing the job to a browser agent.

1. **Tables.** SQL Editor → run each file in `supabase/migrations/` **in filename
   order**, one at a time, waiting for success before the next. The order is not
   cosmetic: later files reference tables the earlier ones create.

   Then confirm the seed data actually landed, rather than trusting seven
   "Success" messages:

   ```sql
   select (select count(*) from metros)        as metros,   -- expect 154
          (select count(*) from metro_zip_map) as zips;     -- expect 491
   ```

   A short count means a migration partly failed, which is easy to miss because
   the editor reports success per statement batch, not per table.

2. **Token.** Edge Functions → Secrets → add `INGEST_TOKEN` with a random hex
   value. **Copy it now** — afterwards only a hash is shown, and recovering it
   means rotating and re-pasting into every browser that uses the connector.

3. **Function.** Edge Functions → Deploy a new function → via Editor. Name it
   exactly `ingest-load` and paste `supabase/functions/ingest-load/index.ts`.
   Its `jsr:` import is a full specifier, so `deno.json` is not needed here.

   > **Turn "Verify JWT" off.** It defaults on, and if it stays on the platform
   > rejects every request with a 401 *before the function runs* — including
   > valid ones. This function authenticates with its own `x-ingest-token`
   > header, not a Supabase JWT, which is why `config.toml` sets
   > `verify_jwt = false` for the CLI path. The failure reads as a bad token
   > rather than a wrong switch, so it is worth confirming rather than assuming.

   Do not set a service-role key: Supabase injects `SUPABASE_SERVICE_ROLE_KEY`
   into deployed functions on its own.

4. **User.** Authentication → Users → Add user. Tick **Auto Confirm User** — an
   unconfirmed account cannot sign in, and the app has no self-serve signup to
   fall back on. Then run the `update profiles` above and check it reports **1
   row**; 0 rows means the profile-creation trigger did not fire, and the account
   would sign in but stay read-only.

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

Deploys run from **GitHub Actions**, not from Cloudflare's own build. The
workflow typechecks, tests, builds, and then pushes the finished `dist/` with
`wrangler pages deploy`. Cloudflare never builds anything, which is why the
config below lives in GitHub rather than in the Cloudflare dashboard.

Set these as **GitHub repository secrets** (Settings -> Secrets and variables
-> Actions):

| Secret | Used by |
|---|---|
| `CLOUDFLARE_API_TOKEN` | the deploy step (needs Pages edit permission) |
| `CLOUDFLARE_ACCOUNT_ID` | the deploy step |
| `VITE_SUPABASE_URL` | the build step |
| `VITE_SUPABASE_ANON_KEY` | the build step |
| `VITE_INGEST_ENDPOINT` | the build step |

> **The `VITE_*` ones are read at BUILD time.** Vite inlines them into the
> bundle, so they must be present when Actions runs `vite build`. Setting them
> in the Cloudflare dashboard does nothing — Cloudflare only receives the
> already-built output. Get this wrong and the site deploys perfectly and shows
> "Finish connecting the desk" forever, which reads as a broken deploy rather
> than missing config.
>
> Changing any of them needs a **new build** to take effect. Re-run the latest
> workflow, or push a commit.

Deep links survive a refresh already: Cloudflare Pages serves `index.html` for
unmatched paths. (On Netlify you would add `_redirects` with
`/*  /index.html  200`.)

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

---

## 5. Confirming a deploy actually landed

A deploy can look fine and not be live. Two traps, both hit during this build:

**Status code proves nothing.** The SPA fallback answers `200` for files that do
not exist, so a missing bundle looks deployed:

```bash
curl -sI https://<project>.pages.dev/assets/<bundle>.js | grep -i content-type
#   application/javascript  -> the file is really there
#   text/html               -> it does NOT exist; the SPA fallback answered
```

**An unchanged hash is not always a stale deploy.** The app and connector are
separate bundles. A change to the tender engine moves only `connector-*.js`,
because the main app does not import it; a change to a route moves only
`app-*.js`. Checking the wrong one gives the wrong answer in both directions.

To find out exactly which commit is live, build it and compare:

```bash
git checkout <commit> && npm run build
ls dist/assets/ | grep -E '^(app|connector)-'
curl -s https://<project>.pages.dev/connector/ | grep -oE 'connector-[A-Za-z0-9_-]+\.js'
```

If the live hash matches an older commit's build, the deploy never published —
it is not a cache. Confirm with `cache-control` on the page (`max-age=0,
must-revalidate` means every request revalidates, so caching is not the cause).

### When the site is stale but CI is green

GitHub Actions passing only proves the code builds. It says nothing about
whether Cloudflare received the push. If `main` is ahead of what is live:

1. **Workers & Pages -> the project -> Deployments.** Is there an attempt for
   the merge commit at all?
2. **No attempt listed** -> the GitHub integration is not firing. Re-check the
   production branch setting and whether Cloudflare's GitHub App still has
   access to the repo; that authorization can lapse silently.
3. **Attempt listed as failed** -> read the build log. The same `npm run build`
   passing locally and in Actions points at the build environment (Node
   version, build command, output directory), not at the code.
4. **Retry deployment** from the dashboard republishes the current branch head
   without needing a new commit.
