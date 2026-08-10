-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: QuickBooks Online integration (run AFTER schema.sql, once).
--
-- Adds token storage for the QuickBooks OAuth connection and an external-id
-- column on transactions so synced expenses upsert idempotently.
-- Safe to re-run (everything is IF NOT EXISTS).
-- ─────────────────────────────────────────────────────────────────────────────

-- Persisted QuickBooks OAuth tokens. Single row (id = 'primary').
-- Service-role only: RLS enabled with zero policies, same as jobber_oauth.
create table if not exists quickbooks_oauth (
  id             text primary key default 'primary',
  access_token   text not null,
  refresh_token  text not null,
  realm_id       text not null,
  expires_at     timestamptz not null,
  last_synced_at timestamptz,
  updated_at     timestamptz not null default now()
);

alter table quickbooks_oauth enable row level security;
-- (no policies on purpose — only the service role, which bypasses RLS, may touch it)

-- External id for QuickBooks-synced spending rows → idempotent upserts.
-- NOTE: this index must NOT be partial. Postgres will not match a partial
-- unique index to a plain `ON CONFLICT (qbo_id)`, which is what the Supabase
-- client emits for `upsert(..., { onConflict: 'qbo_id' })`. A plain unique
-- index is equally safe here: NULLs are distinct, so hand-entered rows with no
-- qbo_id never collide with each other.
alter table transactions add column if not exists qbo_id text;
drop index if exists transactions_qbo_id_key;
create unique index if not exists transactions_qbo_id_key on transactions (qbo_id);
