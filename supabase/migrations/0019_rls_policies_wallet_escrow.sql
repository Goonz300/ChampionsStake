-- ============================================================================
-- Migration 0019: RLS Policies — Wallet & Escrow
-- Tables: wallets, wallet_transactions, wallet_ledger,
--         escrow_accounts, escrow_transactions
--
-- BLANKET RULE FOR THIS FILE: no INSERT, UPDATE, or DELETE policy is defined
-- for `authenticated` or `anon` on ANY table in this migration. With RLS
-- enabled and forced (migration 0017) and no permissive write policy, every
-- write attempt from a client is denied by default. The only role that can
-- write to these tables is `service_role` (used exclusively by Edge
-- Functions, per Architecture §8), which bypasses RLS entirely by Supabase
-- convention. This is the database-level enforcement of "no direct updates
-- from clients" for the wallet engine.
-- ============================================================================

create policy wallets_select_own on wallets
  for select
  using (user_id = auth.uid());

create policy wallets_select_staff on wallets
  for select
  using (is_admin() or is_moderator());

-- Additional defense-in-depth beyond the trigger guard from DB-001: revoke
-- column-level UPDATE privilege on the cached balance columns entirely from
-- authenticated/anon, so even a hypothetical future permissive UPDATE policy
-- on this table could never touch them.
revoke update (available_cents, escrowed_cents) on wallets from authenticated, anon;

create policy wallet_transactions_select_own on wallet_transactions
  for select
  using (owns_wallet(wallet_id));

create policy wallet_transactions_select_staff on wallet_transactions
  for select
  using (is_admin() or is_moderator());

create policy wallet_ledger_select_own on wallet_ledger
  for select
  using (wallet_id is not null and owns_wallet(wallet_id));

create policy wallet_ledger_select_staff on wallet_ledger
  for select
  using (is_admin() or is_moderator());

create policy escrow_accounts_select_participant on escrow_accounts
  for select
  using (
    (challenge_id is not null and is_challenge_participant(challenge_id))
    or
    (tournament_id is not null and exists (
      select 1 from tournament_registrations
      where tournament_id = escrow_accounts.tournament_id and user_id = auth.uid()
    ))
  );

create policy escrow_accounts_select_staff on escrow_accounts
  for select
  using (is_admin() or is_moderator());

create policy escrow_transactions_select_participant on escrow_transactions
  for select
  using (
    exists (
      select 1 from escrow_accounts ea
      where ea.id = escrow_transactions.escrow_account_id
        and (
          (ea.challenge_id is not null and is_challenge_participant(ea.challenge_id))
          or
          (ea.tournament_id is not null and exists (
            select 1 from tournament_registrations
            where tournament_id = ea.tournament_id and user_id = auth.uid()
          ))
        )
    )
  );

create policy escrow_transactions_select_staff on escrow_transactions
  for select
  using (is_admin() or is_moderator());
