-- ============================================================================
-- Migration 0017: Enable Row Level Security
--
-- Enables RLS on every table from DB-001, with FORCE ROW LEVEL SECURITY also
-- applied to every table so that even the table *owner* role is subject to
-- policies (Postgres normally exempts the owner from RLS unless FORCE is
-- set — since Supabase migrations run as a superuser/owner role, skipping
-- FORCE would silently defeat every policy below for that role). service_role
-- still bypasses all of this by Supabase convention (it has the
-- BYPASSRLS attribute), which is the one intentional trust boundary noted in
-- migration 0015.
-- ============================================================================

do $$
declare
  t text;
begin
  for t in
    select unnest(array[
      'profiles', 'devices', 'user_sessions', 'system_settings',
      'wallets', 'wallet_transactions', 'wallet_ledger',
      'escrow_accounts', 'escrow_transactions',
      'platforms', 'regions', 'games',
      'challenges', 'challenge_participants', 'challenge_events',
      'challenge_messages', 'challenge_attachments',
      'tournaments', 'tournament_registrations', 'tournament_rounds', 'tournament_matches',
      'notifications', 'friends', 'reports',
      'disputes', 'dispute_evidence', 'moderator_actions',
      'audit_logs', 'feature_flags'
    ])
  loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
  end loop;
end;
$$;
