# Resin Pros — Operations Dashboard

Internal, real-time operations dashboard for **Resin Pros Flooring LLC**, used by
the two owners to start their day: new leads, job schedule, quotes/invoices,
spending by job, materials/equipment ordering, and a marketing tracker. It syncs
from **Jobber** (the CRM / system of record) and reads from **Supabase**.

This is a standalone Next.js app. It is **not** the public marketing site (that's
a separate Squarespace site) and it does not replace Jobber — it wraps it.

> Runs with zero setup: `npm run dev` works immediately on **fixture data**. Every
> integration (Supabase, Jobber) is optional and turns on when you add its env vars.

---

## Quick start

```bash
npm install
npm run dev        # http://localhost:3000 — fixture data, no login required
```

To point it at real data, copy `.env.example` → `.env.local` and fill in the
blocks you want (see **Environment** below). With none set, the app runs on
fixtures and the login gate is bypassed.

### Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server (fixtures until env is set) |
| `npm run build` | Production build |
| `npm start` | Run the production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint (flat config, `eslint-config-next`) |
| `npm run test` | Vitest unit tests |
| `npm run test:e2e` | Playwright smoke test (builds + serves in fixture mode) |

---

## Architecture

```
config/business.config.ts   Single source of truth: identity, accounts, spend categories.
                            Never hardcode "Resin Pros" — read from here.

lib/db/                     Data layer. Every read goes through lib/db/index.ts, which
  index.ts                  tries Supabase and falls back to fixtures on any error.
  fixtures.ts               Pre-Supabase sample data (keeps the app runnable).
  types.ts                  Domain types the UI consumes.

lib/jobber/                 Jobber integration.
  client.ts                 GraphQL client + OAuth2 (authorize/exchange/refresh, token storage).
  queries.ts                GraphQL documents + raw response types. Fix field renames HERE.
  sync.ts                   Status mapping (pure, tested) + defensive node→domain mappers + syncAll().
  webhooks.ts               HMAC-SHA256 signature verification.

lib/csv/parse.ts            Robust statement CSV parser (quotes, dates, sign conventions).
lib/spending.ts             Pure job-cost aggregation math (tested).
lib/auth/                   proxy.ts (the gate) + session.ts (user + membership).
lib/supabase/               server/browser/admin clients + env detection.
lib/actions/                Server actions (Google Business snapshot save).

app/(dashboard)/            The dashboard, behind the shell + auth gate:
  page.tsx                  Overview (leads, schedule, AR, pipeline)
  leads, jobs, jobs/[id],   Job detail links quotes/invoices/costs/todos.
  quotes, spending,         Spending has the CSV import form.
  materials, marketing, settings
app/login/                  Passwordless (magic-link) login.
app/api/                    transactions/import, jobber/{connect,callback,webhook}, cron/reconcile.
proxy.ts                    Next 16 proxy (formerly middleware) → lib/auth/proxy.ts gate.
supabase/schema.sql         Tables + row-level security. Run once to provision.
```

Every page has real **loading** (Suspense skeletons), **empty** (helpful copy),
and **error** (segment boundary with retry) states, and is responsive down to
~375px.

---

## Environment

See `.env.example` for the full list. Summary:

| Block | Vars | Effect when set |
|---|---|---|
| Supabase | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Enables persistence + magic-link auth. Data layer reads Supabase instead of fixtures. |
| Jobber | `JOBBER_CLIENT_ID`, `JOBBER_CLIENT_SECRET`, `JOBBER_WEBHOOK_SECRET`, `JOBBER_API_VERSION` | Enables OAuth connect + webhook sync. |
| QuickBooks | `QUICKBOOKS_CLIENT_ID`, `QUICKBOOKS_CLIENT_SECRET`, `QUICKBOOKS_ENV` | Enables OAuth connect + daily spending sync into the Spending page. |
| App | `APP_URL`, `CRON_SECRET` | OAuth redirect base + guards the cron reconcile endpoint. |

---

## Supabase setup

1. Run `supabase/schema.sql` in the Supabase SQL editor (creates tables + RLS +
   seeds one business row).
2. Set the three Supabase env vars.
3. **Linking the two owners:** each owner signs in once via magic link (creates
   their `auth.users` row), then add a `business_members` row linking them:

   ```sql
   insert into business_members (business_id, user_id, role)
   values (
     (select id from businesses limit 1),
     (select id from auth.users where email = 'owner@resinprosflooring.com'),
     'owner'
   );
   ```

   Until an account is linked, that user sees a friendly *"your account isn't
   linked to a business yet"* screen instead of an error.

---

## Jobber setup

1. Create an app at <https://developer.getjobber.com/>. Set the redirect URI to
   `${APP_URL}/api/jobber/callback`.
2. Set the Jobber env vars.
3. In the dashboard: **Settings → Connect Jobber** and authorize. Tokens persist
   in the `jobber_oauth` table and auto-refresh.
4. Point Jobber webhooks at `${APP_URL}/api/jobber/webhook` (signed with
   `JOBBER_WEBHOOK_SECRET`). Add a cron (e.g. Vercel Cron) hitting
   `GET /api/cron/reconcile` with `Authorization: Bearer $CRON_SECRET` as the
   missed-webhook backstop.

> **GraphQL field names** follow Jobber's documented schema (verified against the
> public API reference) but haven't been run against a live token.
> `lib/jobber/sync.ts` reads every field defensively and logs a specific warning
> if one is missing, so correcting a rename is a one-line change in
> `lib/jobber/queries.ts`.

---

## QuickBooks setup (spending & banking)

1. Run `supabase/migration-quickbooks.sql` in the Supabase SQL editor (adds the
   `quickbooks_oauth` token table + a `qbo_id` column on `transactions`).
2. Create an app at <https://developer.intuit.com/> (sign in with the company's
   Intuit account → **Create an app** → QuickBooks Online and Payments →
   scope **Accounting**). Under *Keys & credentials* (Production), add the
   redirect URI `${APP_URL}/api/quickbooks/callback` exactly.
3. Set `QUICKBOOKS_CLIENT_ID` / `QUICKBOOKS_CLIENT_SECRET` (and
   `QUICKBOOKS_ENV=production`) in Vercel, redeploy.
4. In the dashboard: **Settings → Connect QuickBooks** and authorize. Tokens
   (plus the company `realmId`) persist in `quickbooks_oauth` and auto-refresh.
5. Spending syncs on the daily cron (`/api/cron/reconcile`): QuickBooks
   **Purchase** transactions (checks, card charges, cash expenses) upsert into
   `transactions` by `qbo_id`, mapped to spending categories by expense-account
   name (`lib/quickbooks/sync.ts → mapAccountNameToCategory`). Unmatched spend
   lands in *Uncategorized* for hand-triage on the Spending page. The first sync
   backfills 365 days; later runs are incremental.

> Note: Intuit refresh tokens expire after ~100 days **without use**; the daily
> cron keeps the connection alive automatically.

---

## Blocked on account setup (Andrew's follow-ups)

The **code is deploy-ready**; these require accounts that can't be created here:

- [ ] Create the Supabase project, run `schema.sql`, set env vars, link both owners.
- [ ] Create the Jobber developer app, set OAuth env vars, connect + configure webhooks.
- [ ] Create GitHub / Vercel projects and set the same env vars there.
- [ ] Confirm the `// TODO(andrew)` placeholders in `config/business.config.ts`
      (phone, address, partner name, bank/account labels, timezone).

Nothing new is blocked beyond these.
