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
alter table transactions add column if not exists qbo_id text;
create unique index if not exists transactions_qbo_id_key
  on transactions (qbo_id) where qbo_id is not null;
