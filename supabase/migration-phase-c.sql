-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: Phase C — write layer (run AFTER schema.sql, once).
--
-- Adds the internal operating tables: tasks, calendar events, notes, activity,
-- audit, attention states, and quote reviews. Follows the existing single-
-- business model: no business_id column (membership IS the boundary, enforced
-- by is_business_member() RLS exactly like the operational tables). A future
-- multi-business migration would add business_id + scoped policies.
--
-- Entity linking is soft (entity_type + entity_id uuid, no FK) because synced
-- tables are replaced by reconciliation; a task must survive its job being
-- re-synced. quote_reviews DOES use a real FK — a review of a deleted quote is
-- meaningless.
--
-- Safe to re-run (IF NOT EXISTS everywhere; policies guarded).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── tasks: one entity for standalone to-dos AND entity-linked tasks ──────────
create table if not exists tasks (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  description   text,
  status        text not null default 'open'
                check (status in ('open','in_progress','done','cancelled')),
  priority      text not null default 'normal'
                check (priority in ('low','normal','high','urgent')),
  -- due_date: the calendar day it's due (business TZ). due_at: set ONLY when
  -- the task has a specific time; it then places itself on the calendar grid.
  due_date      date,
  due_at        timestamptz,
  entity_type   text check (entity_type in ('job','quote','invoice','lead')),
  entity_id     uuid,
  is_personal   boolean not null default false,
  source        text not null default 'manual'
                check (source in ('manual','attention','claude','automation','job','system')),
  reminder_at   timestamptz,
  snoozed_until timestamptz,
  created_by    uuid references auth.users (id) on delete set null,
  assigned_to   uuid references auth.users (id) on delete set null,
  completed_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists tasks_status_due_idx on tasks (status, due_date);
create index if not exists tasks_entity_idx on tasks (entity_type, entity_id);

-- ── internal calendar events (personal + business; Jobber events stay virtual) ─
create table if not exists calendar_events (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  description text,
  kind        text not null default 'personal'
              check (kind in ('personal','business','meeting','reminder','blocked')),
  -- Personal items appear on Today/Calendar but NEVER in business analytics.
  is_personal boolean not null default true,
  starts_at   timestamptz not null,
  ends_at     timestamptz,
  all_day     boolean not null default false,
  entity_type text check (entity_type in ('job','quote','invoice','lead')),
  entity_id   uuid,
  -- 'internal' now; 'external' reserved for a future Google/Outlook connection;
  -- 'jobber' reserved in case job schedule ever materializes as rows.
  source      text not null default 'internal'
              check (source in ('internal','external','jobber')),
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists calendar_events_starts_idx on calendar_events (starts_at);

-- ── notes: internal, never synced to Jobber ──────────────────────────────────
create table if not exists notes (
  id          uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('job','quote','invoice','lead','task')),
  entity_id   uuid not null,
  body        text not null,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists notes_entity_idx on notes (entity_type, entity_id);

-- ── activity: append-oriented "what happened" feed (human-readable) ──────────
create table if not exists activity_log (
  id          uuid primary key default gen_random_uuid(),
  actor       text not null default 'human'
              check (actor in ('human','system','claude','automation')),
  actor_user  uuid references auth.users (id) on delete set null,
  verb        text not null,           -- e.g. task.created, task.completed, note.added
  entity_type text,
  entity_id   uuid,
  summary     text not null,           -- one human sentence
  created_at  timestamptz not null default now()
);
create index if not exists activity_created_idx on activity_log (created_at desc);

-- ── audit: who/what/when/old/new/mechanism — the AI-era paper trail ──────────
create table if not exists audit_log (
  id          uuid primary key default gen_random_uuid(),
  actor_user  uuid references auth.users (id) on delete set null,
  mechanism   text not null default 'human'
              check (mechanism in ('human','claude','automation','sync')),
  action      text not null,           -- e.g. task.create, task.complete, quote.classify
  entity_type text,
  entity_id   uuid,
  old_state   jsonb,
  new_state   jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists audit_created_idx on audit_log (created_at desc);

-- ── attention states: internal ack/snooze/resolve, never touches Jobber ──────
create table if not exists attention_states (
  id            uuid primary key default gen_random_uuid(),
  item_key      text not null unique,  -- the AttentionItem id, e.g. 'quote-<uuid>'
  state         text not null default 'open'
                check (state in ('open','acknowledged','snoozed','resolved')),
  snoozed_until timestamptz,
  updated_by    uuid references auth.users (id) on delete set null,
  updated_at    timestamptz not null default now()
);

-- ── quote reviews: internal pipeline-quality classification ──────────────────
create table if not exists quote_reviews (
  id             uuid primary key default gen_random_uuid(),
  quote_id       uuid not null unique references quotes (id) on delete cascade,
  classification text not null
                 check (classification in ('active','follow_up','likely_dead','known_lost','needs_research')),
  note           text,
  reviewed_by    uuid references auth.users (id) on delete set null,
  reviewed_at    timestamptz not null default now()
);

-- ── row-level security ───────────────────────────────────────────────────────
alter table tasks            enable row level security;
alter table calendar_events  enable row level security;
alter table notes            enable row level security;
alter table activity_log     enable row level security;
alter table audit_log        enable row level security;
alter table attention_states enable row level security;
alter table quote_reviews    enable row level security;

-- Full member access for the operating tables (same model as jobs/quotes/etc).
do $$
declare t text;
begin
  foreach t in array array['tasks','calendar_events','notes','attention_states','quote_reviews']
  loop
    if not exists (select 1 from pg_policies where tablename = t and policyname = t || '_member_all') then
      execute format(
        'create policy %I on %I for all using (is_business_member()) with check (is_business_member());',
        t || '_member_all', t
      );
    end if;
  end loop;
end $$;

-- Activity + audit are append-only for members: insert + select, no update, no
-- delete. (The service role can still prune if ever needed.)
do $$
declare t text;
begin
  foreach t in array array['activity_log','audit_log']
  loop
    if not exists (select 1 from pg_policies where tablename = t and policyname = t || '_member_insert') then
      execute format(
        'create policy %I on %I for insert with check (is_business_member());',
        t || '_member_insert', t
      );
      execute format(
        'create policy %I on %I for select using (is_business_member());',
        t || '_member_select', t
      );
    end if;
  end loop;
end $$;
