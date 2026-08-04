-- ============================================================================
-- Migration 0011: Database Functions
-- Reusable PL/pgSQL functions used by triggers in migration 0012.
-- ============================================================================

-- fn_set_updated_at ---------------------------------------------------------
-- Generic BEFORE UPDATE trigger: stamps updated_at = now() on every row update.
create or replace function fn_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
comment on function fn_set_updated_at() is 'Generic BEFORE UPDATE trigger that stamps updated_at.';

-- fn_wallet_balance -----------------------------------------------------
-- Computes a wallet's balance for a given ledger account_type directly from
-- wallet_ledger (the immutable source of truth). Used both by the cache-sync
-- trigger and by the nightly reconciliation job (Readiness Report §9/§13).
create or replace function fn_wallet_balance(p_wallet_id uuid, p_account_type ledger_account_type)
returns bigint
language sql
stable
as $$
  select coalesce(sum(
    case direction
      when 'credit' then amount_cents
      when 'debit' then -amount_cents
    end
  ), 0)
  from wallet_ledger
  where wallet_id = p_wallet_id
    and account_type = p_account_type;
$$;
comment on function fn_wallet_balance(uuid, ledger_account_type) is
  'Derives a wallet''s available or escrowed balance directly from the immutable wallet_ledger. Never trust a stored column over this.';

-- fn_platform_account_balance -----------------------------------------------
-- Same as above but for the two singleton platform accounts (wallet_id is null).
create or replace function fn_platform_account_balance(p_account_type ledger_account_type)
returns bigint
language sql
stable
as $$
  select coalesce(sum(
    case direction
      when 'credit' then amount_cents
      when 'debit' then -amount_cents
    end
  ), 0)
  from wallet_ledger
  where wallet_id is null
    and account_type = p_account_type;
$$;

-- fn_validate_ledger_balance --------------------------------------------
-- Deferred constraint trigger: verifies that every wallet_transaction_id has
-- balanced debits and credits (double-entry invariant). Fires once per row
-- but is DEFERRABLE INITIALLY DEFERRED, so by the time it actually runs (at
-- COMMIT), every ledger row for that transaction has already been inserted.
create or replace function fn_validate_ledger_balance()
returns trigger
language plpgsql
as $$
declare
  v_debits bigint;
  v_credits bigint;
begin
  select
    coalesce(sum(amount_cents) filter (where direction = 'debit'), 0),
    coalesce(sum(amount_cents) filter (where direction = 'credit'), 0)
  into v_debits, v_credits
  from wallet_ledger
  where wallet_transaction_id = new.wallet_transaction_id;

  if v_debits <> v_credits then
    raise exception
      'Unbalanced ledger entry for wallet_transaction_id %: debits=% credits=%',
      new.wallet_transaction_id, v_debits, v_credits;
  end if;

  return new;
end;
$$;
comment on function fn_validate_ledger_balance() is
  'Deferred constraint trigger enforcing that every wallet_transaction has balanced debit/credit ledger legs.';

-- fn_sync_wallet_cached_balance -----------------------------------------
-- AFTER INSERT trigger on wallet_ledger: recomputes and writes the affected
-- wallet's cached available_cents/escrowed_cents column. Uses a session GUC
-- to authorize the write through fn_guard_wallet_balance_columns below.
create or replace function fn_sync_wallet_cached_balance()
returns trigger
language plpgsql
as $$
begin
  if new.wallet_id is not null and new.account_type in ('available', 'escrowed') then
    perform set_config('versusvault.internal_write', 'on', true);

    if new.account_type = 'available' then
      update wallets
        set available_cents = fn_wallet_balance(new.wallet_id, 'available')
        where id = new.wallet_id;
    else
      update wallets
        set escrowed_cents = fn_wallet_balance(new.wallet_id, 'escrowed')
        where id = new.wallet_id;
    end if;
  end if;

  return new;
end;
$$;
comment on function fn_sync_wallet_cached_balance() is
  'Keeps wallets.available_cents/escrowed_cents in sync with wallet_ledger. The only code path permitted to write those columns.';

-- fn_guard_wallet_balance_columns -----------------------------------------
-- BEFORE UPDATE trigger on wallets: blocks any direct write to
-- available_cents/escrowed_cents unless the internal sync trigger above set
-- the versusvault.internal_write session flag. Defense-in-depth alongside
-- the column-level privilege REVOKE applied in the RLS migration (Phase 2).
create or replace function fn_guard_wallet_balance_columns()
returns trigger
language plpgsql
as $$
begin
  if (new.available_cents is distinct from old.available_cents
      or new.escrowed_cents is distinct from old.escrowed_cents)
     and coalesce(current_setting('versusvault.internal_write', true), 'off') <> 'on' then
    raise exception
      'wallets.available_cents/escrowed_cents may only be modified via wallet_ledger inserts, never directly.';
  end if;

  return new;
end;
$$;

-- fn_prevent_mutation -----------------------------------------------------
-- Generic BEFORE UPDATE OR DELETE trigger: blocks all mutation. Attached to
-- every immutable table (wallet_ledger, wallet_transactions once terminal,
-- escrow_transactions, challenge_events, dispute_evidence, moderator_actions,
-- audit_logs).
create or replace function fn_prevent_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception
    '% rows are immutable and may not be updated or deleted (attempted on id=%).',
    tg_table_name, coalesce(old.id, null);
end;
$$;
comment on function fn_prevent_mutation() is
  'Generic guard blocking UPDATE/DELETE on append-only tables.';

-- fn_prevent_completed_transaction_mutation --------------------------------
-- wallet_transactions is the one "immutable-ish" table that legitimately
-- needs updates while pending (status transitions, completed_at, failure
-- reason). Once it reaches a terminal status, no further mutation is allowed.
create or replace function fn_prevent_completed_transaction_mutation()
returns trigger
language plpgsql
as $$
begin
  if old.status in ('completed', 'failed', 'reversed') then
    raise exception
      'wallet_transactions.id=% is in terminal status % and may not be modified further.',
      old.id, old.status;
  end if;

  return new;
end;
$$;

-- fn_challenge_state_guard --------------------------------------------------
-- BEFORE UPDATE trigger on challenges: enforces that status only ever moves
-- along an edge of the state machine defined in Business Rules §3. This is a
-- structural guard (valid graph edges); timing rules (10-minute ready-check
-- window, 24h response window, etc.) are enforced by the Edge Functions in
-- Roadmap Phase 4, not at the database layer.
create or replace function fn_challenge_state_guard()
returns trigger
language plpgsql
as $$
declare
  v_allowed boolean;
begin
  if new.status = old.status then
    return new;
  end if;

  v_allowed := (old.status, new.status) in (
    ('draft', 'published'),
    ('published', 'waiting'),
    ('published', 'expired'),
    ('published', 'cancelled'),
    ('waiting', 'accepted'),
    ('waiting', 'expired'),
    ('waiting', 'cancelled'),
    ('accepted', 'escrow_locked'),
    ('accepted', 'cancelled'),
    ('escrow_locked', 'ready'),
    ('ready', 'live'),
    ('ready', 'cancelled'),
    ('live', 'winner_submitted'),
    ('live', 'moderator_review'),
    ('winner_submitted', 'awaiting_confirmation'),
    ('winner_submitted', 'disputed'),
    ('awaiting_confirmation', 'released'),
    ('awaiting_confirmation', 'disputed'),
    ('awaiting_confirmation', 'moderator_review'),
    ('disputed', 'moderator_review'),
    ('moderator_review', 'completed'),
    ('moderator_review', 'cancelled'),
    ('released', 'completed'),
    ('completed', 'archived'),
    ('cancelled', 'archived'),
    ('expired', 'archived')
  );

  if not v_allowed then
    raise exception
      'Invalid challenge status transition % -> % for challenge id=%.',
      old.status, new.status, old.id;
  end if;

  return new;
end;
$$;
comment on function fn_challenge_state_guard() is
  'Enforces the Business Rules §3 challenge state machine as a whitelist of valid status-transition edges.';

-- fn_challenge_messages_read_only_guard --------------------------------
-- BEFORE INSERT trigger on challenge_messages: blocks new messages once the
-- parent challenge is in a terminal state (Business Rules §8).
create or replace function fn_challenge_messages_read_only_guard()
returns trigger
language plpgsql
as $$
declare
  v_status challenge_status;
begin
  select status into v_status from challenges where id = new.challenge_id;

  if v_status in ('completed', 'cancelled', 'expired', 'archived') then
    raise exception
      'Chat for challenge id=% is read-only (status=%).', new.challenge_id, v_status;
  end if;

  return new;
end;
$$;

-- fn_tournament_state_guard ------------------------------------------------
create or replace function fn_tournament_state_guard()
returns trigger
language plpgsql
as $$
declare
  v_allowed boolean;
begin
  if new.status = old.status then
    return new;
  end if;

  v_allowed := (old.status, new.status) in (
    ('draft', 'registration'),
    ('registration', 'check_in'),
    ('registration', 'cancelled'),
    ('check_in', 'in_progress'),
    ('check_in', 'cancelled'),
    ('in_progress', 'completed'),
    ('completed', 'archived'),
    ('cancelled', 'archived')
  );

  if not v_allowed then
    raise exception
      'Invalid tournament status transition % -> % for tournament id=%.',
      old.status, new.status, old.id;
  end if;

  return new;
end;
$$;
comment on function fn_tournament_state_guard() is
  'Enforces the Business Rules §5 tournament state machine as a whitelist of valid status-transition edges.';

-- fn_disputes_rationale_required -------------------------------------------
-- BEFORE UPDATE trigger on disputes: a resolved dispute must carry a
-- rationale of meaningful length (Business Rules §10 — "must record a
-- written rationale for every decision, stored on the disputes record, not
-- optional").
create or replace function fn_disputes_rationale_required()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'resolved'
     and (new.resolution_rationale is null or char_length(new.resolution_rationale) < 10) then
    raise exception
      'A resolution_rationale of at least 10 characters is required to resolve dispute id=%.', new.id;
  end if;

  return new;
end;
$$;

-- fn_write_audit_log --------------------------------------------------------
-- Convenience function other Edge Functions/triggers can call to insert a
-- consistent audit_logs row. SECURITY DEFINER so it can be called by roles
-- that don't otherwise have direct INSERT on audit_logs (enforced in the RLS
-- migration, Phase 2) while still guaranteeing every audit row goes through
-- one code path.
create or replace function fn_write_audit_log(
  p_actor_id uuid,
  p_actor_type actor_type,
  p_action text,
  p_category audit_action_category,
  p_target_table text,
  p_target_id text,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into audit_logs (actor_id, actor_type, action, category, target_table, target_id, metadata)
  values (p_actor_id, p_actor_type, p_action, p_category, p_target_table, p_target_id, p_metadata)
  returning id into v_id;

  return v_id;
end;
$$;
comment on function fn_write_audit_log is
  'Single, consistent entry point for writing audit_logs rows, including system-triggered events with a null actor_id.';
