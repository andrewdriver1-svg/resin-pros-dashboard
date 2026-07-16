-- ─────────────────────────────────────────────────────────────────────────────
-- Resin Pros Ops Dashboard — Supabase schema
--
-- Run this in the Supabase SQL editor (or `supabase db push`) to provision the
-- database. Until it's run, the app reads fixtures and auth is bypassed in dev.
--
-- Model: exactly one business, two members (the owner + partner). Access control
-- is membership-based: any authenticated user with a `business_members` row can
-- read/write operational data. Sync/webhook/cron writes use the service role,
-- which bypasses RLS. There is no public/anon access to any table.
-- ─────────────────────────────────────────────────────────────────────────────

create extension if not exists "pgcrypto";

-- ── identity ─────────────────────────────────────────────────────────────────
create table if not exists businesses (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_at timestamptz not null default now()
);

-- Links a Supabase auth user to the business. The presence of a row here is what
-- the app checks to decide "is your account linked to a business yet?".
create table if not exists business_members (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  role        text not null default 'owner',
  created_at  timestamptz not null default now(),
  unique (user_id)
);

-- Helper: is the current user a member of any business?
create or replace function is_business_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from business_members m where m.user_id = auth.uid()
  );
$$;

-- ── operational tables ───────────────────────────────────────────────────────
create table if not exists jobs (
  id           uuid primary key default gen_random_uuid(),
  jobber_id    text unique,
  title        text not null default 'Untitled job',
  client_name  text not null default 'Unknown client',
  address      text,
  status       text not null default 'unknown',
  scheduled_at timestamptz,
  completed_at timestamptz,
  value        numeric not null default 0,
  notes        text,
  updated_at   timestamptz not null default now()
);

create table if not exists quotes (
  id          uuid primary key default gen_random_uuid(),
  jobber_id   text unique,
  job_id      uuid references jobs (id) on delete set null,
  number      text not null default '',
  client_name text not null default 'Unknown client',
  status      text not null default 'unknown',
  amount      numeric not null default 0,
  issued_at   date,
  updated_at  timestamptz not null default now()
);

create table if not exists invoices (
  id          uuid primary key default gen_random_uuid(),
  jobber_id   text unique,
  job_id      uuid references jobs (id) on delete set null,
  number      text not null default '',
  client_name text not null default 'Unknown client',
  status      text not null default 'unknown',
  amount      numeric not null default 0,
  amount_paid numeric not null default 0,
  issued_at   date,
  due_at      date,
  updated_at  timestamptz not null default now()
);

create table if not exists job_costs (
  id          uuid primary key default gen_random_uuid(),
  job_id      uuid not null references jobs (id) on delete cascade,
  category_id text not null default 'uncategorized',
  description text not null default '',
  amount      numeric not null default 0,
  date        date not null default current_date,
  account_id  text,
  source      text not null default 'manual',
  created_at  timestamptz not null default now()
);
create index if not exists job_costs_job_id_idx on job_costs (job_id);

create table if not exists material_todos (
  id         uuid primary key default gen_random_uuid(),
  job_id     uuid references jobs (id) on delete cascade,
  kind       text not null default 'material',
  item       text not null default '',
  quantity   text,
  status     text not null default 'needed',
  needed_by  date,
  notes      text,
  created_at timestamptz not null default now()
);

create table if not exists leads (
  id            uuid primary key default gen_random_uuid(),
  jobber_id     text unique,
  client_name   text not null default 'Unknown',
  contact_email text,
  contact_phone text,
  summary       text not null default '',
  received_at   timestamptz not null default now(),
  source        text not null default 'unknown',
  status        text not null default 'new',
  job_id        uuid references jobs (id) on delete set null
);

create table if not exists marketing_entries (
  id         uuid primary key default gen_random_uuid(),
  channel    text not null default '',
  period     date not null default current_date,
  spend      numeric not null default 0,
  leads      integer not null default 0,
  won_jobs   integer not null default 0,
  notes      text,
  created_at timestamptz not null default now()
);

create table if not exists transactions (
  id          uuid primary key default gen_random_uuid(),
  date        date not null default current_date,
  description text not null default '',
  amount      numeric not null default 0,
  category_id text not null default 'uncategorized',
  account_id  text,
  job_id      uuid references jobs (id) on delete set null,
  source      text not null default 'manual',
  created_at  timestamptz not null default now()
);

-- Google Business Profile snapshot — no reliable public write API, so this is
-- updated by hand from the Settings page. Newest row wins.
create table if not exists google_business_snapshot (
  id                   uuid primary key default gen_random_uuid(),
  rating               numeric not null default 0,
  review_count         integer not null default 0,
  phone                text not null default '',
  hours                text not null default '',
  profile_strength_ok  boolean not null default true,
  facebook_followers   integer not null default 0,
  instagram_followers  integer not null default 0,
  updated_at           timestamptz not null default now()
);

-- Persisted Jobber OAuth tokens. Single row (id = 'primary'). Service-role only.
create table if not exists jobber_oauth (
  id            text primary key default 'primary',
  access_token  text not null,
  refresh_token text not null,
  expires_at    timestamptz not null,
  updated_at    timestamptz not null default now()
);

-- ── row-level security ───────────────────────────────────────────────────────
alter table businesses               enable row level security;
alter table business_members         enable row level security;
alter table jobs                     enable row level security;
alter table quotes                   enable row level security;
alter table invoices                 enable row level security;
alter table job_costs                enable row level security;
alter table material_todos           enable row level security;
alter table leads                    enable row level security;
alter table marketing_entries        enable row level security;
alter table transactions             enable row level security;
alter table google_business_snapshot enable row level security;
alter table jobber_oauth             enable row level security;

-- Members see their own membership + the business they belong to.
create policy members_read_self on business_members
  for select using (user_id = auth.uid());
create policy members_read_business on businesses
  for select using (
    exists (select 1 from business_members m where m.business_id = businesses.id and m.user_id = auth.uid())
  );

-- Operational tables: any authenticated business member gets full access.
-- (One business, two members — membership IS the authorization boundary.)
do $$
declare t text;
begin
  foreach t in array array[
    'jobs','quotes','invoices','job_costs','material_todos',
    'leads','marketing_entries','transactions','google_business_snapshot'
  ]
  loop
    execute format(
      'create policy %I on %I for all using (is_business_member()) with check (is_business_member());',
      t || '_member_all', t
    );
  end loop;
end $$;

-- jobber_oauth: no policy → only the service role (which bypasses RLS) can touch it.
-- (Leaving RLS enabled with zero policies denies all anon/authenticated access.)

-- ── seed one business (edit the name, then link members via the app) ─────────
insert into businesses (name)
select 'Resin Pros Flooring LLC'
where not exists (select 1 from businesses);
