-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE E migration — email intelligence + lead candidates.
-- Additive and idempotent: safe to re-run; no drops of existing objects, no
-- destructive alters, no changes to existing rows. Run AFTER migration-phase-c2.
--
-- Design notes:
--   * Email is READ-ONLY intelligence. These tables never drive writes back to
--     the mailbox; the provider (Gmail) remains the source of truth for mail.
--   * OAuth tokens live in email_accounts with NO member policies — service
--     role only, same pattern as jobber_oauth. Tokens never reach the browser.
--   * Thread/message/intelligence rows are written by the sync (service role)
--     and readable by members; the only member-writable email state is the
--     thread review status + lead_candidates, both changed through the audited
--     action layer.
--   * email_intelligence is DERIVED interpretation, kept separate from source
--     facts (email_messages) so an enrichment upgrade can rewrite it without
--     touching what the provider actually said.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── email_accounts (service-role only; single business mailbox) ──────────────
create table if not exists email_accounts (
  id             text primary key default 'primary',
  provider       text not null default 'gmail' check (provider in ('gmail')),
  address        text not null default '',
  access_token   text not null default '',
  refresh_token  text not null default '',
  expires_at     timestamptz,
  -- Incremental sync watermark: newest internalDate already ingested.
  watermark_at   timestamptz,
  status         text not null default 'connected' check (status in ('connected','error','disconnected')),
  last_error     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ── email_threads (one business conversation) ────────────────────────────────
create table if not exists email_threads (
  id                  uuid primary key default gen_random_uuid(),
  provider_thread_id  text not null unique,
  subject             text not null default '',
  -- [{address, name}] of external participants (own mailbox excluded).
  participants        jsonb not null default '[]'::jsonb,
  message_count       integer not null default 0,
  first_message_at    timestamptz,
  last_message_at     timestamptz,
  -- Owner review state (internal; changed via audited actions only).
  status              text not null default 'open' check (status in ('open','reviewed','dismissed')),
  -- Deterministic entity links (soft, confidence-scored; manual correction wins).
  linked_customer_id  uuid,
  linked_entity_type  text check (linked_entity_type in ('quote','invoice','job','lead')),
  linked_entity_id    uuid,
  link_confidence     numeric,
  link_mechanism      text,
  first_detected_at   timestamptz not null default now(),
  last_detected_at    timestamptz not null default now()
);
create index if not exists email_threads_last_msg_idx on email_threads (last_message_at desc);
create index if not exists email_threads_customer_idx on email_threads (linked_customer_id);

-- ── email_messages (source facts; bounded extract, never full HTML) ──────────
create table if not exists email_messages (
  id                   uuid primary key default gen_random_uuid(),
  provider_message_id  text not null unique,
  thread_id            uuid not null references email_threads(id) on delete cascade,
  from_address         text not null default '',
  from_name            text not null default '',
  to_addresses         jsonb not null default '[]'::jsonb,
  sent_at              timestamptz,
  subject              text not null default '',
  -- Cleaned plain-text extract, capped at ingest (~4KB). Not the full mailbox.
  body_extract         text not null default '',
  has_attachments      boolean not null default false,
  -- [{filename, mimeType, size}] only — attachment bytes are never stored.
  attachment_meta      jsonb not null default '[]'::jsonb,
  retrieved_at         timestamptz not null default now()
);
create index if not exists email_messages_thread_idx on email_messages (thread_id, sent_at);

-- ── email_intelligence (derived; one row per thread; rewritable) ─────────────
create table if not exists email_intelligence (
  id               uuid primary key default gen_random_uuid(),
  thread_id        uuid not null unique references email_threads(id) on delete cascade,
  classification   text not null default 'unknown' check (classification in
    ('new_lead','bid_invitation','existing_customer','existing_quote','existing_job',
     'scheduling','payment_accounting','vendor','internal_admin','newsletter_marketing','unknown')),
  summary          text not null default '',
  urgency          text not null default 'normal' check (urgency in ('urgent','normal','low')),
  action_required  boolean not null default false,
  waiting_on       text check (waiting_on in ('us','them')),
  lead_likelihood  numeric not null default 0,
  detected_company  text,
  detected_location text,
  detected_scope    text,
  confidence       numeric not null default 0,
  -- 'rules:v1' today; 'claude:<model>' when Phase D enrichment exists. The
  -- mechanism is stored so AI interpretation is never presented as source fact.
  mechanism        text not null default 'rules:v1',
  updated_at       timestamptz not null default now()
);

-- ── lead_candidates (inbound business awaiting the owner's judgment) ─────────
create table if not exists lead_candidates (
  id                 uuid primary key default gen_random_uuid(),
  source             text not null check (source in ('email','market_radar','website','manual')),
  -- Provenance pointer (email thread id, radar opportunity id, …).
  source_ref         text,
  email_thread_id    uuid references email_threads(id) on delete set null,
  company            text not null default '',
  contact_name       text not null default '',
  contact_email      text,
  contact_phone      text,
  summary            text not null default '',
  location           text,
  estimated_scope    text,
  status             text not null default 'new' check (status in ('new','reviewed','converted','dismissed')),
  linked_customer_id uuid,
  linked_task_id     uuid,
  created_at         timestamptz not null default now(),
  reviewed_at        timestamptz,
  reviewed_by        uuid references auth.users(id)
);
create index if not exists lead_candidates_status_idx on lead_candidates (status, created_at desc);
create unique index if not exists lead_candidates_thread_uniq on lead_candidates (email_thread_id) where email_thread_id is not null;

-- ── sync_runs: allow the email source ────────────────────────────────────────
do $$
declare c text;
begin
  select conname into c from pg_constraint
    where conrelid = 'sync_runs'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) like '%source%';
  if c is not null then execute format('alter table sync_runs drop constraint %I', c); end if;
  alter table sync_runs add constraint sync_runs_source_check
    check (source in ('jobber','quickbooks','email'));
end $$;

-- Per-run email counters (0 for other sources; additive columns).
alter table sync_runs add column if not exists messages_scanned integer not null default 0;
alter table sync_runs add column if not exists messages_relevant integer not null default 0;
alter table sync_runs add column if not exists candidates_created integer not null default 0;

-- ── row-level security ───────────────────────────────────────────────────────
alter table email_accounts     enable row level security;  -- no policies → service role only
alter table email_threads      enable row level security;
alter table email_messages     enable row level security;
alter table email_intelligence enable row level security;
alter table lead_candidates    enable row level security;

do $$
begin
  -- Members read email intelligence; only the sync (service role) writes it.
  if not exists (select 1 from pg_policies where tablename = 'email_threads' and policyname = 'email_threads_member_select') then
    create policy email_threads_member_select on email_threads for select using (is_business_member());
  end if;
  -- Review status changes go through the audited action layer, under the
  -- user's session — so members need UPDATE on threads (status/links only in
  -- practice; the action layer is the write surface).
  if not exists (select 1 from pg_policies where tablename = 'email_threads' and policyname = 'email_threads_member_update') then
    create policy email_threads_member_update on email_threads for update
      using (is_business_member()) with check (is_business_member());
  end if;
  if not exists (select 1 from pg_policies where tablename = 'email_messages' and policyname = 'email_messages_member_select') then
    create policy email_messages_member_select on email_messages for select using (is_business_member());
  end if;
  if not exists (select 1 from pg_policies where tablename = 'email_intelligence' and policyname = 'email_intelligence_member_select') then
    create policy email_intelligence_member_select on email_intelligence for select using (is_business_member());
  end if;
  -- Lead candidates: members review, convert, dismiss (audited actions).
  if not exists (select 1 from pg_policies where tablename = 'lead_candidates' and policyname = 'lead_candidates_member_all') then
    create policy lead_candidates_member_all on lead_candidates
      for all using (is_business_member()) with check (is_business_member());
  end if;
end $$;
