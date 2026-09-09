# Paste this into Claude in Chrome

## One-time: let GitHub Actions update the database

---

You're doing a one-time setup so that a code repository can update its own
Supabase database and deploy its own function automatically. After this,
nobody has to paste SQL into the dashboard again.

**Never report either secret value back in the chat.** Copy each one straight
into GitHub and then forget it. If you lose one before it's saved, generate
or reset it again — do not go looking for it in history.

**Supabase project ref:** `afwwwprqpnkbmtwmasmm`
**GitHub repo:** https://github.com/GODRIC423/solvix-tender-desk

## Step 0 — Make sure you are in the right Supabase account

Supabase treats "sign in with GitHub" and "sign in with email" as two
different accounts. The token has to come from the one that owns the project.

1. Go to https://supabase.com/dashboard/projects
2. Confirm the list shows a project whose ref is `afwwwprqpnkbmtwmasmm`
   (open it and check the URL contains that ref).
3. If it does not, sign out and sign in the other way until it does. Do not
   continue until you are looking at that project from this account.

## Step 1 — Create a Supabase access token

1. In that same signed-in session, go to https://supabase.com/dashboard/account/tokens
2. If a token named `GitHub Actions` already exists, delete it first.
3. **Generate new token**. Name it `GitHub Actions`. Copy the token.

## Step 2 — Get the database password

1. Go to https://supabase.com/dashboard/project/afwwwprqpnkbmtwmasmm/settings/database
2. Find **Database password** and click **Reset database password**. Copy the
   new password *before leaving the page* — it is shown once.
   (Resetting is safe: nothing else uses this password yet.)

## Step 3 — Put both into GitHub

Go to https://github.com/GODRIC423/solvix-tender-desk/settings/secrets/actions
and add two **repository secrets**, names exactly as written:

| Name | Value |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | the token from Step 1 |
| `SUPABASE_DB_PASSWORD` | the password from Step 2 |

## Step 4 — Run the pipeline

1. Go to https://github.com/GODRIC423/solvix-tender-desk/actions/workflows/ci.yml
2. Open the most recent run on `main` and click **Re-run all jobs**.
3. Wait for it to finish (2–3 minutes).

## Step 5 — Report back

- Whether the run is green
- If any step failed, its name and the last ~15 lines of its log
- Confirm both secrets are saved (names only — never the values)

---

## After Chrome finishes

Nothing. From now on, merging a pull request applies any new database
migration, redeploys the ingest function, and publishes the site — in that
order, so the site never runs ahead of the database.

---
---

## Reference — earlier one-time steps (already done)

<details>
<summary>Original project setup</summary>

1. **SQL Editor** — migrations `20260101000000` through `20260101000006`
   run by hand. Verified `metros = 154`, `metro_zip_map = 491`.
2. **Edge Functions → Secrets** — `INGEST_TOKEN` set.
3. **Edge Functions** — `ingest-load` deployed from the editor with
   Verify JWT off. (Now redeployed by CI on every merge.)
4. **Authentication → Users** — `Setups@adeulintelligence.com` created and
   promoted to admin.

</details>
