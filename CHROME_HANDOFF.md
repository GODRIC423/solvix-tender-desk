# Claude in Chrome handoffs

## Nothing to do right now

Setup is complete. GitHub Actions holds working Supabase credentials and, on
every merge to `main`, applies any new database migration, redeploys the
ingest function, and publishes the site — in that order.

The sections below are kept as the record of what was done and as paste-ready
prompts if a credential ever has to be replaced.

---
---

## If a credential ever needs replacing

<details>
<summary>Replace the Supabase access token</summary>

Paste into Claude in Chrome:

> You're replacing one secret. **Never report the value back in the chat.**
>
> 1. Go to https://supabase.com/dashboard/projects and confirm this account's
>    list shows the project with ref `afwwwprqpnkbmtwmasmm`. If it doesn't,
>    sign out and sign in the other way (GitHub vs email are separate
>    accounts) until it does.
> 2. In that session go to https://supabase.com/dashboard/account/tokens.
>    Delete any token named `GitHub Actions`, then **Generate new token** with
>    that name and all permissions. Copy it.
> 3. Go to https://github.com/GODRIC423/solvix-tender-desk/settings/secrets/actions,
>    edit the existing `SUPABASE_ACCESS_TOKEN`, paste, **Update secret**.
> 4. Go to https://github.com/GODRIC423/solvix-tender-desk/actions/workflows/ci.yml
>    and **Run workflow** on `main`. Report whether it goes green.

</details>

<details>
<summary>Replace the database password</summary>

Paste into Claude in Chrome:

> You're replacing one secret. **Never report the value back in the chat.**
>
> 1. Go to https://supabase.com/dashboard/project/afwwwprqpnkbmtwmasmm/settings/database
>    and click **Reset database password**. Copy the new value before leaving
>    the page. If the button is unavailable, stop and report that — the
>    signed-in account is not an Owner/Admin of this project.
> 2. Go to https://github.com/GODRIC423/solvix-tender-desk/settings/secrets/actions,
>    edit the existing `SUPABASE_DB_PASSWORD`, paste with nothing before or
>    after it, **Update secret**.
> 3. Wait two minutes (the reset takes a moment to reach the connection
>    pooler), then go to
>    https://github.com/GODRIC423/solvix-tender-desk/actions/workflows/ci.yml
>    and **Run workflow** on `main`. Report whether it goes green.

</details>

---
---

## Record — one-time steps already done

<details>
<summary>Original project setup</summary>

1. **SQL Editor** — migrations `20260101000000` through `20260101000007`
   run by hand. Verified `metros = 154`, `metro_zip_map = 491`, and for
   Phase 2: `10 · 3 · 72 · true · 6`.
2. **Edge Functions → Secrets** — `INGEST_TOKEN` set.
3. **Edge Functions** — `ingest-load` deployed with Verify JWT off. (Now
   redeployed by CI on every merge.)
4. **Authentication → Users** — `Setups@adeulintelligence.com` created and
   promoted to admin.
5. **GitHub secrets** — `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
   `VITE_INGEST_ENDPOINT`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`,
   `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`.

</details>
