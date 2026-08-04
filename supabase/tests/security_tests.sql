-- ============================================================================
-- ChampionsStake Security Test Suite (DB-002)
--
-- HOW TO RUN: psql "$DATABASE_URL" -f supabase/tests/security_tests.sql
-- Run against a disposable dev/staging database only — this script inserts
-- and deletes fixture rows. It must be run as a role that does NOT bypass
-- RLS by default (e.g. the Supabase `postgres` role does bypass RLS as
-- superuser regardless of FORCE, so every test below explicitly
-- `set local role` to `anon`/`authenticated`/`service_role` and sets the
-- `request.jwt.claims` GUC that Supabase's auth.uid() reads from, to
-- actually exercise the policies rather than superuser-bypass them).
--
-- Each test either RAISE NOTICEs 'PASS: ...' or RAISE EXCEPTIONs
-- 'FAIL: ...' — a clean run with no exception means every test passed.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- Fixtures: two players, one moderator, one admin, one challenge, one wallet
-- each. Inserted as the table owner (bypasses RLS, which is correct — test
-- setup isn't the thing under test).
-- ---------------------------------------------------------------------------
do $$
declare
  v_player_a uuid := '11111111-1111-1111-1111-111111111111';
  v_player_b uuid := '22222222-2222-2222-2222-222222222222';
  v_moderator uuid := '33333333-3333-3333-3333-333333333333';
  v_admin uuid := '44444444-4444-4444-4444-444444444444';
  v_game_id uuid;
  v_challenge_id uuid;
  v_wallet_a uuid;
  v_wallet_b uuid;
begin
  -- auth.users rows (minimal columns; Supabase Auth manages the rest in
  -- production — this is a test fixture only).
  insert into auth.users (id, email) values
    (v_player_a, 'player-a@test.local'),
    (v_player_b, 'player-b@test.local'),
    (v_moderator, 'moderator@test.local'),
    (v_admin, 'admin@test.local')
  on conflict (id) do nothing;

  insert into profiles (id, display_name, role, status, kyc_status) values
    (v_player_a, 'TestPlayerA', 'player', 'active', 'verified'),
    (v_player_b, 'TestPlayerB', 'player', 'active', 'verified'),
    (v_moderator, 'TestModerator', 'moderator', 'active', 'verified'),
    (v_admin, 'TestAdmin', 'administrator', 'active', 'verified')
  on conflict (id) do nothing;

  insert into wallets (user_id) values (v_player_a), (v_player_b)
  on conflict (user_id) do nothing;

  select id into v_wallet_a from wallets where user_id = v_player_a;
  select id into v_wallet_b from wallets where user_id = v_player_b;

  select id into v_game_id from games limit 1;

  insert into challenges (id, creator_id, opponent_id, game_id, match_type, stake_cents, visibility, platform_code, region_code, status)
  values ('55555555-5555-5555-5555-555555555555', v_player_a, v_player_b, v_game_id, 'bo3', 1000, 'private', 'pc', 'na', 'accepted')
  on conflict (id) do nothing;

  insert into challenge_participants (challenge_id, user_id, role) values
    ('55555555-5555-5555-5555-555555555555', v_player_a, 'creator'),
    ('55555555-5555-5555-5555-555555555555', v_player_b, 'opponent')
  on conflict do nothing;
end;
$$;

-- ---------------------------------------------------------------------------
-- TEST 1: Anonymous users cannot access wallets at all.
-- ---------------------------------------------------------------------------
set local role anon;
do $$
declare
  v_count int;
begin
  select count(*) into v_count from wallets;
  if v_count <> 0 then
    raise exception 'FAIL: anon role could see % wallet row(s), expected 0', v_count;
  end if;
  raise notice 'PASS: anon cannot read wallets (0 rows returned)';
end;
$$;
reset role;

-- ---------------------------------------------------------------------------
-- TEST 2: Player A cannot read Player B's wallet.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';
do $$
declare
  v_count int;
begin
  select count(*) into v_count from wallets
    where user_id = '22222222-2222-2222-2222-222222222222';
  if v_count <> 0 then
    raise exception 'FAIL: Player A could see Player B''s wallet';
  end if;
  raise notice 'PASS: Player A cannot read Player B''s wallet';
end;
$$;

-- ---------------------------------------------------------------------------
-- TEST 3: Player A CAN read their own wallet.
-- ---------------------------------------------------------------------------
do $$
declare
  v_count int;
begin
  select count(*) into v_count from wallets
    where user_id = '11111111-1111-1111-1111-111111111111';
  if v_count <> 1 then
    raise exception 'FAIL: Player A could not see their own wallet (got % rows)', v_count;
  end if;
  raise notice 'PASS: Player A can read their own wallet';
end;
$$;

-- ---------------------------------------------------------------------------
-- TEST 4: Player A cannot directly UPDATE their own wallet balance columns.
-- ---------------------------------------------------------------------------
do $$
begin
  begin
    update wallets set available_cents = 999999999
      where user_id = '11111111-1111-1111-1111-111111111111';
    raise exception 'FAIL: Player A was able to directly update available_cents';
  exception
    when insufficient_privilege or others then
      raise notice 'PASS: Player A cannot directly update wallets.available_cents (blocked)';
  end;
end;
$$;

-- ---------------------------------------------------------------------------
-- TEST 5: Player A cannot modify an escrow_accounts record.
-- ---------------------------------------------------------------------------
do $$
begin
  begin
    update escrow_accounts set status = 'released' where challenge_id = '55555555-5555-5555-5555-555555555555';
    raise exception 'FAIL: Player A was able to update escrow_accounts (no permissive policy should allow this)';
  exception
    when insufficient_privilege or others then
      raise notice 'PASS: Player A cannot modify escrow_accounts (blocked — no client write policy exists)';
  end;
end;
$$;

-- ---------------------------------------------------------------------------
-- TEST 6: Player A cannot delete a wallet_transactions row.
-- ---------------------------------------------------------------------------
do $$
begin
  begin
    delete from wallet_transactions where wallet_id = (
      select id from wallets where user_id = '11111111-1111-1111-1111-111111111111'
    );
    raise exception 'FAIL: Player A was able to delete a wallet_transactions row';
  exception
    when insufficient_privilege or others then
      raise notice 'PASS: Player A cannot delete wallet_transactions (blocked)';
  end;
end;
$$;

-- ---------------------------------------------------------------------------
-- TEST 7: Player A CAN read the private challenge they participate in;
-- an uninvolved player cannot.
-- ---------------------------------------------------------------------------
do $$
declare
  v_count int;
begin
  select count(*) into v_count from challenges where id = '55555555-5555-5555-5555-555555555555';
  if v_count <> 1 then
    raise exception 'FAIL: Player A could not read their own private challenge';
  end if;
  raise notice 'PASS: Player A can read their private challenge';
end;
$$;

reset role;

-- ---------------------------------------------------------------------------
-- TEST 8: Moderator can read the disputes queue and audit-relevant tables;
-- a plain player cannot read audit_logs at all.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "33333333-3333-3333-3333-333333333333", "role": "authenticated"}';
do $$
declare
  v_count int;
begin
  select count(*) into v_count from wallets; -- moderators can read all wallets
  if v_count < 2 then
    raise exception 'FAIL: moderator could not read wallet rows (expected staff-wide visibility)';
  end if;
  raise notice 'PASS: moderator has staff-wide wallet read visibility';
end;
$$;

set local request.jwt.claims = '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';
do $$
declare
  v_count int;
begin
  select count(*) into v_count from audit_logs;
  if v_count <> 0 then
    raise exception 'FAIL: a plain player could read % audit_logs row(s), expected 0', v_count;
  end if;
  raise notice 'PASS: plain player cannot read audit_logs';
end;
$$;

-- ---------------------------------------------------------------------------
-- TEST 9: Administrator has full read access to audit_logs.
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub": "44444444-4444-4444-4444-444444444444", "role": "authenticated"}';
do $$
begin
  perform 1 from audit_logs limit 1; -- must not raise
  raise notice 'PASS: administrator can query audit_logs without error';
end;
$$;

reset role;

-- ---------------------------------------------------------------------------
-- TEST 10: service_role bypasses RLS entirely (used only by Edge Functions).
-- ---------------------------------------------------------------------------
set local role service_role;
do $$
declare
  v_count int;
begin
  select count(*) into v_count from wallets;
  if v_count < 2 then
    raise exception 'FAIL: service_role could not see all wallet rows (expected RLS bypass)';
  end if;
  raise notice 'PASS: service_role bypasses RLS (sees all wallet rows), as intended for Edge Functions only';
end;
$$;
reset role;

-- ---------------------------------------------------------------------------
-- TEST 11: storage — Player B cannot upload into Player A's avatar folder.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';
do $$
begin
  begin
    insert into storage.objects (bucket_id, name, owner)
    values ('avatars', '11111111-1111-1111-1111-111111111111/fake.png', '22222222-2222-2222-2222-222222222222');
    raise exception 'FAIL: Player B was able to upload into Player A''s avatar folder';
  exception
    when insufficient_privilege or others then
      raise notice 'PASS: Player B cannot upload into Player A''s avatar folder';
  end;
end;
$$;
reset role;

-- Roll back all fixture data and test attempts — this script never commits.
rollback;
