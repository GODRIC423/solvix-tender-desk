# Paste this into Claude in Chrome

## Apply the Phase 2 migration

---

You're applying one database migration to an existing Supabase project for a
freight-brokerage TMS app. The tables already exist; this adds columns, two
tables, some views and functions. It is safe to run once. If you run it twice
by mistake it will error partway through — that is fine, nothing is lost.

**Project ref:** `afwwwprqpnkbmtwmasmm`
**Dashboard:** https://supabase.com/dashboard/project/afwwwprqpnkbmtwmasmm

## Step 1 — Run the migration

Go to **SQL Editor**. Fetch the full raw contents of

`https://raw.githubusercontent.com/GODRIC423/solvix-tender-desk/main/supabase/migrations/20260101000007_phase2_permissions_flags_crm.sql`

paste all of it into a new query, and Run. It is about 700 lines. Wait for
"Success". If it errors, **stop and report the exact error text** — do not
try to fix it or run part of it again.

## Step 2 — Verify

Run this and report the result:

```sql
select
  (select count(*) from public.customer_interaction_types)                        as interaction_types,
  (select count(*) from information_schema.columns
     where table_name = 'profiles' and column_name in ('team','permissions','preferences')) as profile_cols,
  (select flag_rules -> 'unbooked' -> 'yellow' ->> 'hours' from public.org_settings where id = 1) as yellow_hours,
  (select role_permissions -> 'dispatcher' ->> 'create_loads' from public.org_settings where id = 1) as dispatcher_can_create,
  (select count(*) from pg_proc where proname in
     ('has_permission','import_carriers','import_customers','create_manual_load','add_load_stop','update_load_stop')) as functions;
```

Expected: `interaction_types = 10`, `profile_cols = 3`, `yellow_hours = 72`,
`dispatcher_can_create = true`, `functions = 6`. Anything else means it did not
fully apply — report the numbers you got.

## Step 3 — Report back

- Whether Step 1 said Success
- The five numbers from Step 2
- Any error text, verbatim

---

## After Chrome finishes

Nothing else to do. The app at **https://solvix-tender-desk.pages.dev** will
pick the new columns up on its own — no redeploy needed for the database side.

---
---

## Reference — the original project setup (already done)

Kept for the record. Do not run again.

<details>
<summary>Original setup steps</summary>

**Project ref:** `afwwwprqpnkbmtwmasmm`

1. **SQL Editor** — run migrations `20260101000000` through `20260101000006`
   from `https://raw.githubusercontent.com/GODRIC423/solvix-tender-desk/main/supabase/migrations/`
   in order. Verify `metros = 154`, `metro_zip_map = 491`.
2. **Edge Functions → Secrets** — add `INGEST_TOKEN` (48-char random hex).
   Report the value; it is not shown again.
3. **Edge Functions → Deploy via Editor** — name `ingest-load`, body from
   `supabase/functions/ingest-load/index.ts`. **Verify JWT must be OFF.**
4. **Authentication → Users → Add user** — `Setups@adeulintelligence.com`,
   auto-confirm.
5. **SQL Editor** —
   `update profiles set role = 'admin', full_name = 'Solvix Admin' where email = 'Setups@adeulintelligence.com';`
   must report 1 row.

</details>
