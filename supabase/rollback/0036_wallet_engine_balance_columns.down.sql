-- Rollback 0036: Wallet Engine Balance Columns
grant update (pending_cents, bonus_cents, referral_cents) on wallets to authenticated, anon;

-- Restore the DB-001 versions of these two functions (2-account-type scope).
create or replace function fn_sync_wallet_cached_balance()
returns trigger
language plpgsql
as $$
begin
  if new.wallet_id is not null and new.account_type in ('available', 'escrowed') then
    perform set_config('versusvault.internal_write', 'on', true);
    if new.account_type = 'available' then
      update wallets set available_cents = fn_wallet_balance(new.wallet_id, 'available') where id = new.wallet_id;
    else
      update wallets set escrowed_cents = fn_wallet_balance(new.wallet_id, 'escrowed') where id = new.wallet_id;
    end if;
  end if;
  return new;
end;
$$;

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

alter table wallets
  drop constraint if exists chk_wallets_referral_nonneg,
  drop constraint if exists chk_wallets_bonus_nonneg,
  drop constraint if exists chk_wallets_pending_nonneg;

alter table wallets
  drop column if exists referral_cents,
  drop column if exists bonus_cents,
  drop column if exists pending_cents;
