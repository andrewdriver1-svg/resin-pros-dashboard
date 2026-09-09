-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE C.2 migration — customer entity + sync observability.
-- Additive and idempotent: safe to re-run; no drops, no destructive alters,
-- no changes to existing rows. Run AFTER migration-phase-c.sql.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── customers ────────────────────────────────────────────────────────────────
-- Keyed on Jobber's stable client id (already delivered by every sync query and
-- previously discarded). The sync upserts these; internal records (tasks/notes)
-- can link to them via the generic entity mechanism.
create table if not exists customers (
  id                uuid primary key default gen_random_uuid(),
  jobber_client_id  text not null unique,
  name              text not null default 'Unknown client',
  email             text,
  phone             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- ── stable client id on synced records ───────────────────────────────────────
alter table jobs     add column if not exists jobber_client_id text;
alter table quotes   add column if not exists jobber_client_id text;
alter table invoices add column if not exists jobber_client_id text;
alter table leads    add column if not exists jobber_client_id text;

create index if not exists jobs_client_idx     on jobs (jobber_client_id);
create index if not exists quotes_client_idx   on quotes (jobber_client_id);
create index if not exists invoices_client_idx on invoices (jobber_client_id);
create index if not exists leads_client_idx    on leads (jobber_client_id);

-- ── let tasks and notes link to a customer ───────────────────────────────────
-- The Phase-C check constraints enumerate entity types; extend them additively.
do $$
declare c text;
begin
  -- Find the existing check by definition (inline checks get auto-generated
  -- names), drop it, and re-add with 'customer' allowed. Nothing else changes.
  select conname into c from pg_constraint
    where conrelid = 'tasks'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) like '%entity_type%';
  if c is not null then execute format('alter table tasks drop constraint %I', c); end if;
  alter table tasks add constraint tasks_entity_type_check
    check (entity_type is null or entity_type in ('job','quote','invoice','lead','customer'));

  select conname into c from pg_constraint
    where conrelid = 'notes'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) like '%entity_type%';
  if c is not null then execute format('alter table notes drop constraint %I', c); end if;
  alter table notes add constraint notes_entity_type_check
    check (entity_type in ('job','quote','invoice','lead','task','customer'));
end $$;

-- ── sync observability ───────────────────────────────────────────────────────
-- The truth of "when did we last sync" — max(updated_at) on synced tables only
-- records row INSERTS (no update triggers exist by design), which is why the
-- freshness gauge drifted amber while the sync ran fine. Every sync now records
-- an explicit run here; the Systems indicator and the missed-sync alert read it.
create table if not exists sync_runs (
  id        bigint generated always as identity primary key,
  source    text not null check (source in ('jobber','quickbooks')),
  ran_at    timestamptz not null default now(),
  ok        boolean not null,
  jobs      integer not null default 0,
  quotes    integer not null default 0,
  invoices  integer not null default 0,
  leads     integer not null default 0,
  errors    jsonb not null default '[]'::jsonb
);
create index if not exists sync_runs_source_ran_idx on sync_runs (source, ran_at desc);

-- ── row-level security ───────────────────────────────────────────────────────
alter table customers enable row level security;
alter table sync_runs enable row level security;

do $$
begin
  -- customers: members get full access (same boundary as every operational table).
  if not exists (select 1 from pg_policies where tablename = 'customers' and policyname = 'customers_member_all') then
    create policy customers_member_all on customers
      for all using (is_business_member()) with check (is_business_member());
  end if;
  -- sync_runs: members may READ the health record; only the service role
  -- (RLS-exempt) writes it — the dashboard cannot forge sync history.
  if not exists (select 1 from pg_policies where tablename = 'sync_runs' and policyname = 'sync_runs_member_select') then
    create policy sync_runs_member_select on sync_runs
      for select using (is_business_member());
  end if;
end $$;
