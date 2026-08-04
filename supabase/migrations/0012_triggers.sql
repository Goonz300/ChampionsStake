-- ============================================================================
-- Migration 0012: Triggers
-- Wires the functions from migration 0011 onto the tables from 0003-0010.
-- ============================================================================

-- updated_at triggers ---------------------------------------------------
create trigger trg_profiles_updated_at before update on profiles
  for each row execute function fn_set_updated_at();
create trigger trg_devices_updated_at before update on devices
  for each row execute function fn_set_updated_at();
create trigger trg_user_sessions_updated_at before update on user_sessions
  for each row execute function fn_set_updated_at();
create trigger trg_system_settings_updated_at before update on system_settings
  for each row execute function fn_set_updated_at();
create trigger trg_wallets_updated_at before update on wallets
  for each row execute function fn_set_updated_at();
create trigger trg_wallet_transactions_updated_at before update on wallet_transactions
  for each row execute function fn_set_updated_at();
create trigger trg_escrow_accounts_updated_at before update on escrow_accounts
  for each row execute function fn_set_updated_at();
create trigger trg_games_updated_at before update on games
  for each row execute function fn_set_updated_at();
create trigger trg_platforms_updated_at before update on platforms
  for each row execute function fn_set_updated_at();
create trigger trg_regions_updated_at before update on regions
  for each row execute function fn_set_updated_at();
create trigger trg_challenges_updated_at before update on challenges
  for each row execute function fn_set_updated_at();
create trigger trg_challenge_participants_updated_at before update on challenge_participants
  for each row execute function fn_set_updated_at();
create trigger trg_tournaments_updated_at before update on tournaments
  for each row execute function fn_set_updated_at();
create trigger trg_tournament_registrations_updated_at before update on tournament_registrations
  for each row execute function fn_set_updated_at();
create trigger trg_tournament_rounds_updated_at before update on tournament_rounds
  for each row execute function fn_set_updated_at();
create trigger trg_tournament_matches_updated_at before update on tournament_matches
  for each row execute function fn_set_updated_at();
create trigger trg_friends_updated_at before update on friends
  for each row execute function fn_set_updated_at();
create trigger trg_reports_updated_at before update on reports
  for each row execute function fn_set_updated_at();
create trigger trg_disputes_updated_at before update on disputes
  for each row execute function fn_set_updated_at();
create trigger trg_feature_flags_updated_at before update on feature_flags
  for each row execute function fn_set_updated_at();

-- Ledger balance invariant (deferred constraint trigger) -------------------
create constraint trigger trg_wallet_ledger_validate_balance
  after insert on wallet_ledger
  deferrable initially deferred
  for each row execute function fn_validate_ledger_balance();

-- Cached-balance sync -----------------------------------------------------
create trigger trg_wallet_ledger_sync_balance
  after insert on wallet_ledger
  for each row execute function fn_sync_wallet_cached_balance();

-- Guard against direct writes to wallets.available_cents/escrowed_cents ---
create trigger trg_wallets_guard_balance_columns
  before update on wallets
  for each row execute function fn_guard_wallet_balance_columns();

-- Immutability guards (block all UPDATE/DELETE) ----------------------------
create trigger trg_wallet_ledger_immutable
  before update or delete on wallet_ledger
  for each row execute function fn_prevent_mutation();

create trigger trg_escrow_transactions_immutable
  before update or delete on escrow_transactions
  for each row execute function fn_prevent_mutation();

create trigger trg_challenge_events_immutable
  before update or delete on challenge_events
  for each row execute function fn_prevent_mutation();

create trigger trg_dispute_evidence_immutable
  before update or delete on dispute_evidence
  for each row execute function fn_prevent_mutation();

create trigger trg_moderator_actions_immutable
  before update or delete on moderator_actions
  for each row execute function fn_prevent_mutation();

create trigger trg_audit_logs_immutable
  before update or delete on audit_logs
  for each row execute function fn_prevent_mutation();

-- wallet_transactions: block DELETE entirely, and block UPDATE once terminal
create trigger trg_wallet_transactions_no_delete
  before delete on wallet_transactions
  for each row execute function fn_prevent_mutation();

create trigger trg_wallet_transactions_no_mutation_after_terminal
  before update on wallet_transactions
  for each row execute function fn_prevent_completed_transaction_mutation();

-- Challenge / tournament state-machine guards -------------------------------
create trigger trg_challenges_state_guard
  before update on challenges
  for each row execute function fn_challenge_state_guard();

create trigger trg_tournaments_state_guard
  before update on tournaments
  for each row execute function fn_tournament_state_guard();

-- Chat read-only enforcement -----------------------------------------------
create trigger trg_challenge_messages_read_only_guard
  before insert on challenge_messages
  for each row execute function fn_challenge_messages_read_only_guard();

-- Dispute resolution rationale requirement ---------------------------------
create trigger trg_disputes_rationale_required
  before update on disputes
  for each row execute function fn_disputes_rationale_required();
