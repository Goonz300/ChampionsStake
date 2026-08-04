-- Rollback 0017: Disable Row Level Security
-- WARNING: this reopens every table to the default Postgres grant model.
-- Never run against a database serving real traffic; provided for clean
-- development-environment rollback only.
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
    execute format('alter table %I no force row level security', t);
    execute format('alter table %I disable row level security', t);
  end loop;
end;
$$;
