-- ─────────────────────────────────────────────────────────────────────────────
-- Phase C.1 §2 — RLS verification (run in Supabase SQL editor AFTER the
-- migration). Every block is wrapped in a transaction and ROLLED BACK — no
-- test data survives. Each SELECT prints a PASS/FAIL verdict.
-- ─────────────────────────────────────────────────────────────────────────────

-- TEST 1: anonymous (no JWT) — must see nothing and write nothing.
begin;
set local role anon;
select 'T1a anon read tasks: ' || case when (select count(*) from tasks) = 0 then 'PASS (0 rows visible)' else 'FAIL' end;
do $$
begin
  begin
    insert into tasks (title) values ('anon should fail');
    raise notice 'T1b anon insert: FAIL (insert succeeded)';
  exception when insufficient_privilege or others then
    raise notice 'T1b anon insert: PASS (denied: %)', sqlerrm;
  end;
end $$;
rollback;

-- TEST 2: authenticated user WITHOUT a business_members row — must be denied.
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
select 'T2a non-member read tasks: ' || case when (select count(*) from tasks) = 0 then 'PASS (0 rows visible)' else 'FAIL' end;
select 'T2b non-member read audit: ' || case when (select count(*) from audit_log) = 0 then 'PASS' else 'FAIL' end;
do $$
begin
  begin
    insert into tasks (title) values ('non-member should fail');
    raise notice 'T2c non-member insert: FAIL (insert succeeded)';
  exception when others then
    raise notice 'T2c non-member insert: PASS (denied: %)', sqlerrm;
  end;
end $$;
rollback;

-- TEST 3: authenticated MEMBER — must be able to read and write.
begin;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', (select user_id from business_members limit 1), 'role', 'authenticated')::text, true);
insert into tasks (title, priority) values ('RLS test — member insert', 'low') returning 'T3a member insert: PASS (id ' || id || ')';
select 'T3b member read own insert: ' || case when exists(select 1 from tasks where title = 'RLS test — member insert') then 'PASS' else 'FAIL' end;
update tasks set status = 'done', completed_at = now() where title = 'RLS test — member insert';
select 'T3c member update: ' || case when exists(select 1 from tasks where title = 'RLS test — member insert' and status = 'done') then 'PASS' else 'FAIL' end;
rollback;  -- test rows discarded

-- TEST 4: append-only logs — member may insert+select but NOT update/delete.
begin;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', (select user_id from business_members limit 1), 'role', 'authenticated')::text, true);
insert into activity_log (verb, summary) values ('test.rls', 'RLS test entry');
select 'T4a member activity insert: PASS';
do $$
declare n int;
begin
  update activity_log set summary = 'tampered' where verb = 'test.rls';
  get diagnostics n = row_count;
  if n = 0 then raise notice 'T4b activity update: PASS (0 rows affected — no update policy)';
  else raise notice 'T4b activity update: FAIL (% rows updated)', n; end if;
  delete from activity_log where verb = 'test.rls';
  get diagnostics n = row_count;
  if n = 0 then raise notice 'T4c activity delete: PASS (0 rows affected — no delete policy)';
  else raise notice 'T4c activity delete: FAIL (% rows deleted)', n; end if;
end $$;
rollback;

-- TEST 5: forged foreign entity id — a quote_review for a nonexistent quote
-- must be rejected by the FK even for a valid member.
begin;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', (select user_id from business_members limit 1), 'role', 'authenticated')::text, true);
do $$
begin
  begin
    insert into quote_reviews (quote_id, classification) values (gen_random_uuid(), 'active');
    raise notice 'T5 forged quote id: FAIL (insert succeeded)';
  exception when foreign_key_violation then
    raise notice 'T5 forged quote id: PASS (FK rejected nonexistent quote)';
  end;
end $$;
rollback;
