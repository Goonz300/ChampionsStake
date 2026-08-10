# Phase 8.5 — Financial Verification

An adversarial re-verification of the wallet ledger's correctness guarantees, done by reading the actual enforcement mechanisms directly (not re-trusting prior phases' own claims), plus a set of ad-hoc SQL reconciliation queries as an ops deliverable — distinct from the automated reconciliation sweep that already exists (`_wallet/reconciliation.ts`), for a human to run directly against the database when investigating an incident.

## The core guarantee, re-verified

**Claim**: every wallet balance is provably derived from `wallet_ledger`, never independently maintained, and can never go negative or become unbalanced.

**Verification chain** (each link checked directly against the code/SQL, not assumed):

1. **`postBalancedEntries()`** (`_wallet/ledger.ts`) is the *only* code path that inserts into `wallet_ledger`/`wallet_transactions` — confirmed by grep: zero other `insert into wallet_ledger` or `.from("wallet_ledger").insert(` anywhere in `supabase/functions/`.
2. It rejects an unbalanced request (`netDebits !== netCredits`) **before opening a transaction** — a fast, clear failure, not a silent corruption.
3. It row-locks every wallet touched, in **stable sorted order**, before checking balances — the standard deadlock-avoidance pattern (two concurrent transfers touching the same two wallets in opposite order cannot deadlock, because both always acquire locks in the same global order).
4. It re-validates available balance **after** acquiring the lock, querying the true ledger-derived balance (not a cached column) — closes the exact TOCTOU race a naive "check then write" would have.
5. At the database layer, `fn_validate_ledger_balance()` (migration `0011_functions.sql`) is a `DEFERRABLE INITIALLY DEFERRED` constraint trigger that re-sums every `wallet_transaction_id`'s debits/credits at COMMIT and raises an exception if they don't match — this is the backstop that fires **regardless of which code path produced the rows**, so even a hypothetical future bug in `postBalancedEntries` couldn't silently commit an unbalanced transaction.
6. `wallets.available_cents`/`escrowed_cents` (the cached columns the rest of the app reads for speed) are **not** independently incremented — `fn_sync_wallet_cached_balance()` recomputes them from scratch via `fn_wallet_balance()` (a pure `sum(credit) - sum(debit)` over `wallet_ledger`) on every relevant ledger insert. This means the cached column is always a fresh materialization of the same query the balance-check and the reconciliation sweep both use — it cannot drift from the ledger by construction, not merely by convention.
7. `fn_guard_wallet_balance_columns()` plus a column-level `REVOKE` make any direct write to `available_cents`/`escrowed_cents` outside the sync trigger raise an exception.

**Conclusion**: the "every balance is ledger-derived, ledger is always balanced" guarantee is structural at three independent layers (application check, DB constraint trigger, column-write guard), not a single point of failure. This matches and re-confirms the Step 1 audit's and Step 4's findings, verified here a third time via the actual trigger SQL rather than the prior summaries of it.

## Existing automated reconciliation (verified, not rebuilt)

`_wallet/reconciliation.ts`'s `runReconciliation` already exists and is well-built: paginates through all wallets (500/page, explicitly designed for 100,000+), compares all 5 cached balance columns against `fn_wallet_balance` for every wallet, and **automatically freezes any wallet with a mismatch** pending manual review (Business Rules §15). Scheduled daily at 03:00 UTC (migration `0039_wallet_reconciliation_schedule.sql`, off-peak). Performance-parallelized this phase (see `PHASE8_5_PERFORMANCE_REVIEW.md` finding #5) — no correctness change, only wall-clock time.

## Ad-hoc SQL reconciliation queries (ops deliverable)

For manual investigation, independent of the automated sweep above. Run directly against the database (read-only, safe to run anytime).

**No orphaned transactions** (every `wallet_transactions` row has at least one `wallet_ledger` leg, and vice versa):
```sql
-- Transactions with zero ledger legs (should never happen -- postBalancedEntries
-- always inserts legs in the same transaction as the wallet_transactions row)
select wt.id, wt.type, wt.created_at
from wallet_transactions wt
left join wallet_ledger wl on wl.wallet_transaction_id = wt.id
where wl.id is null;

-- Ledger legs referencing a transaction that doesn't exist (should be
-- impossible -- wallet_transaction_id has a NOT NULL FK to wallet_transactions)
select wl.id, wl.wallet_transaction_id
from wallet_ledger wl
left join wallet_transactions wt on wt.id = wl.wallet_transaction_id
where wt.id is null;
```

**No unbalanced ledger entries** (should be structurally impossible per `fn_validate_ledger_balance`; this query re-derives the same check independently):
```sql
select wallet_transaction_id,
       sum(amount_cents) filter (where direction = 'debit')  as total_debits,
       sum(amount_cents) filter (where direction = 'credit') as total_credits
from wallet_ledger
group by wallet_transaction_id
having sum(amount_cents) filter (where direction = 'debit')
     <> sum(amount_cents) filter (where direction = 'credit');
```

**No negative balances** (should be structurally impossible per the pre-debit balance check in `postBalancedEntries`):
```sql
select id, user_id, available_cents, escrowed_cents, pending_cents, bonus_cents, referral_cents
from wallets
where available_cents < 0 or escrowed_cents < 0 or pending_cents < 0
   or bonus_cents < 0 or referral_cents < 0;
```

**No cached-vs-ledger drift** (the same check `runReconciliation` runs automatically, as a direct SQL cross-check):
```sql
select w.id, w.user_id,
       w.available_cents, fn_wallet_balance(w.id, 'available') as ledger_available,
       w.escrowed_cents,  fn_wallet_balance(w.id, 'escrowed')  as ledger_escrowed
from wallets w
where w.available_cents <> fn_wallet_balance(w.id, 'available')
   or w.escrowed_cents  <> fn_wallet_balance(w.id, 'escrowed');
```

**No duplicate payouts** (idempotency key reused across distinct transactions -- should be impossible given the unique index on `wallet_transactions.idempotency_key`, migration `0004`):
```sql
select idempotency_key, count(*), array_agg(id)
from wallet_transactions
where idempotency_key is not null
group by idempotency_key
having count(*) > 1;
```

**No double withdrawals** (a wallet with more than one non-terminal withdrawal-type transaction in flight simultaneously):
```sql
select wallet_id, count(*), array_agg(id)
from wallet_transactions
where type = 'withdrawal' and status not in ('completed', 'failed', 'reversed')
group by wallet_id
having count(*) > 1;
```

## Verification result

Every query above was checked against the schema/trigger definitions for logical correctness (they express the same invariants the DB triggers already enforce, as an independent cross-check) but **not executed against live data** — no live database exists in this environment. They are runnable deliverables for a real environment, per `PHASE8_5_DEPLOYMENT_GUIDE.md`'s go-live checklist.
