-- ============================================================================
-- Migration 0082: Escrow Accounts Atomic Adjust Function
--
-- Phase 6 audit finding (verified against the actual repository, not
-- speculative): escrow_accounts.total_locked_cents/status/released_at were
-- never updated by any code path after row creation (getOrCreateEscrowAccount,
-- _challenge/repository.ts) -- confirmed by grep, zero .update() calls against
-- escrow_accounts anywhere in supabase/functions/. escrow_transactions
-- (the "immutable log of every lock/release/refund/void event", per its own
-- migration 0005 comment) has zero INSERT call sites at all. Both tables are
-- read by admin/moderator surfaces (_admin/analytics.ts, _admin/dashboard.ts,
-- _moderator/cases.ts) that therefore see permanently-stale "locked,
-- total_locked_cents=0" data regardless of real state. The actual money
-- movement (via wallet_ledger, through _wallet/transfer.ts's lockToEscrow/
-- releaseFromEscrow) has always been correct -- only these two bookkeeping/
-- observability tables were never wired up.
--
-- fn_adjust_escrow_locked is a single atomic UPDATE statement (not an
-- application-level read-then-write) specifically because tournament escrow
-- is POOLED -- multiple players' lockToEscrow calls for the same tournament
-- concurrently increment the SAME escrow_accounts row (escrow_accounts.
-- tournament_id is unique -- one container per tournament, migration 0005).
-- A read-then-write in application code would race under concurrent
-- registrations; a single `total_locked_cents = total_locked_cents + delta`
-- UPDATE does not, since Postgres evaluates the right-hand side against the
-- row as it exists at that statement's execution, under the row's own lock.
--
-- GREATEST(0, ...) on decrement is a deliberate defensive clamp, not a
-- correctness compromise: any escrow_accounts row created before this
-- migration has total_locked_cents=0 regardless of real (already-locked)
-- funds, since no prior code ever incremented it. Without clamping, the
-- first release against one of these pre-existing rows would attempt to
-- decrement 0 by a positive amount, violating chk_escrow_accounts_total_nonneg
-- and failing the release outright -- which must never happen, since the
-- actual wallet_ledger money movement in that same release call is correct
-- and must not be blocked by this purely-observational table. The tradeoff:
-- total_locked_cents for challenges/tournaments that were already escrow-
-- locked before this migration deployed will read inaccurately-low until
-- that specific escrow fully releases, at which point it correctly reaches
-- zero and status transitions correctly. This is a one-time, self-healing
-- transition, not an ongoing gap -- documented in docs/ESCROW_ARCHITECTURE.md.
-- ============================================================================

create or replace function fn_adjust_escrow_locked(p_escrow_account_id uuid, p_delta_cents bigint)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_total bigint;
begin
  update escrow_accounts
  set total_locked_cents = greatest(0, total_locked_cents + p_delta_cents),
      updated_at = now()
  where id = p_escrow_account_id
  returning total_locked_cents into v_new_total;

  return v_new_total;
end;
$$;
comment on function fn_adjust_escrow_locked is
  'Atomically increments (lock) or decrements (release/refund/void, negative delta) escrow_accounts.total_locked_cents in a single UPDATE statement, safe under concurrent callers (e.g. pooled tournament escrow, multiple registrants locking into the same row). Clamped at zero to tolerate pre-migration-0082 rows whose total_locked_cents was never previously tracked.';
