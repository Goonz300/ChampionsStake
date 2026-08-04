-- ============================================================================
-- Migration 0036: Wallet Engine Balance Columns
--
-- Adds pending_cents, bonus_cents, referral_cents to wallets — cached
-- projections of wallet_ledger, exactly like available_cents/escrowed_cents
-- from DB-001 (never written directly; only fn_sync_wallet_cached_balance
-- may write them, exactly the same pattern, extended rather than replaced).
-- ============================================================================

alter table wallets
  add column pending_cents bigint not null default 0,
  add column bonus_cents bigint not null default 0,
  add column referral_cents bigint not null default 0;

alter table wallets
  add constraint chk_wallets_pending_nonneg check (pending_cents >= 0),
  add constraint chk_wallets_bonus_nonneg check (bonus_cents >= 0),
  add constraint chk_wallets_referral_nonneg check (referral_cents >= 0);

comment on column wallets.pending_cents is
  'Cached projection of wallet_ledger for account_type=pending (in-flight funds not yet settled, e.g. a withdrawal awaiting provider confirmation). Never written directly.';
comment on column wallets.bonus_cents is
  'Cached projection of wallet_ledger for account_type=bonus (promotional credit). Never written directly.';
comment on column wallets.referral_cents is
  'Cached projection of wallet_ledger for account_type=referral (referral-program credit). Never written directly.';

-- Extend the balance-column guard trigger to cover the three new columns —
-- replaces DB-001's fn_guard_wallet_balance_columns with a superset version
-- (same function name, same trigger, so no trigger re-wiring is needed).
create or replace function fn_guard_wallet_balance_columns()
returns trigger
language plpgsql
as $$
begin
  if (new.available_cents is distinct from old.available_cents
      or new.escrowed_cents is distinct from old.escrowed_cents
      or new.pending_cents is distinct from old.pending_cents
      or new.bonus_cents is distinct from old.bonus_cents
      or new.referral_cents is distinct from old.referral_cents)
     and coalesce(current_setting('versusvault.internal_write', true), 'off') <> 'on' then
    raise exception
      'wallets balance columns may only be modified via wallet_ledger inserts, never directly.';
  end if;

  return new;
end;
$$;

-- Extend the cache-sync trigger function to handle all 5 account types
-- (replaces DB-001's version — same function/trigger name, superset logic).
create or replace function fn_sync_wallet_cached_balance()
returns trigger
language plpgsql
as $$
begin
  if new.wallet_id is not null and new.account_type in ('available', 'escrowed', 'pending', 'bonus', 'referral') then
    perform set_config('versusvault.internal_write', 'on', true);

    case new.account_type
      when 'available' then
        update wallets set available_cents = fn_wallet_balance(new.wallet_id, 'available') where id = new.wallet_id;
      when 'escrowed' then
        update wallets set escrowed_cents = fn_wallet_balance(new.wallet_id, 'escrowed') where id = new.wallet_id;
      when 'pending' then
        update wallets set pending_cents = fn_wallet_balance(new.wallet_id, 'pending') where id = new.wallet_id;
      when 'bonus' then
        update wallets set bonus_cents = fn_wallet_balance(new.wallet_id, 'bonus') where id = new.wallet_id;
      when 'referral' then
        update wallets set referral_cents = fn_wallet_balance(new.wallet_id, 'referral') where id = new.wallet_id;
    end case;
  end if;

  return new;
end;
$$;

-- Extend the column-level REVOKE from DB-002 to the three new columns too.
revoke update (pending_cents, bonus_cents, referral_cents) on wallets from authenticated, anon;
