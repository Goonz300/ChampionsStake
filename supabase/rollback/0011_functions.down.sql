-- Rollback 0011: Database Functions
drop function if exists fn_write_audit_log(uuid, actor_type, text, audit_action_category, text, text, jsonb);
drop function if exists fn_disputes_rationale_required();
drop function if exists fn_tournament_state_guard();
drop function if exists fn_challenge_messages_read_only_guard();
drop function if exists fn_challenge_state_guard();
drop function if exists fn_prevent_completed_transaction_mutation();
drop function if exists fn_prevent_mutation();
drop function if exists fn_guard_wallet_balance_columns();
drop function if exists fn_sync_wallet_cached_balance();
drop function if exists fn_validate_ledger_balance();
drop function if exists fn_platform_account_balance(ledger_account_type);
drop function if exists fn_wallet_balance(uuid, ledger_account_type);
drop function if exists fn_set_updated_at();
