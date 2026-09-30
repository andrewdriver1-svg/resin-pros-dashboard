-- Phase E post-migration verification (run AFTER migration-phase-e-email.sql).
-- Supabase SQL editor shows only the LAST statement's result, so run each
-- numbered block separately.

-- [1] Tables exist (expect 5 rows)
select table_name from information_schema.tables
where table_schema = 'public'
  and table_name in ('email_accounts','email_threads','email_messages','email_intelligence','lead_candidates')
order by table_name;

-- [2] RLS enabled on all five (expect rowsecurity = true on every row)
select relname, relrowsecurity from pg_class
where relname in ('email_accounts','email_threads','email_messages','email_intelligence','lead_candidates');

-- [3] Policies (expect: email_accounts NONE — service-role only;
--     threads select+update, messages select, intelligence select, candidates ALL)
select tablename, policyname, cmd from pg_policies
where tablename in ('email_accounts','email_threads','email_messages','email_intelligence','lead_candidates')
order by tablename, policyname;

-- [4] Indexes (expect unique on provider ids, partial unique on candidates.email_thread_id,
--     plus last_message_at / customer / thread-sent / status indexes)
select tablename, indexname from pg_indexes
where tablename in ('email_accounts','email_threads','email_messages','email_intelligence','lead_candidates')
order by tablename, indexname;

-- [5] sync_runs widened (expect 3 rows of new counters + check constraint containing 'email')
select column_name from information_schema.columns
where table_name = 'sync_runs'
  and column_name in ('messages_scanned','messages_relevant','candidates_created');

-- [6] sync_runs source check includes email
select pg_get_constraintdef(oid) from pg_constraint
where conrelid = 'sync_runs'::regclass and contype = 'c';

-- [7] Anonymous access denied to tokens (expect ZERO rows / permission error)
set local role anon;
select count(*) from email_accounts;
reset role;

-- [8] Authenticated-but-anonymous member gate: policies reference is_business_member
select tablename, policyname, qual from pg_policies
where tablename in ('email_threads','email_messages','email_intelligence','lead_candidates');

-- [9] Existing operational tables untouched (compare to pre-migration counts)
select
  (select count(*) from jobs) as jobs,
  (select count(*) from quotes) as quotes,
  (select count(*) from invoices) as invoices,
  (select count(*) from leads) as leads,
  (select count(*) from customers) as customers,
  (select count(*) from tasks) as tasks,
  (select count(*) from activity_log) as activity,
  (select count(*) from audit_log) as audit;
