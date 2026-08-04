// supabase/functions/_wallet/ledger.ts
//
// The ONE function that ever writes to wallet_transactions/wallet_ledger.
// Every wallet feature (transfer.ts, service.ts) builds a TransferRequest
// and calls postBalancedEntries — there is no second code path that inserts
// ledger rows, which is what makes "every balance is ledger-derived" an
// actual guarantee rather than a convention someone could accidentally
// bypass.

import { withTransaction } from "../_shared/transactions/index.ts";
import { WalletError, ConflictError } from "../_shared/errors/index.ts";
import type { TransferRequest, TransferResult } from "./types.ts";

/**
 * DESIGN NOTE on wallet_transactions.wallet_id: that column is NOT NULL and
 * singular (DB-001 migration 0004), but a single transfer can touch more
 * than one wallet's ledger (e.g. a future escrow release moving the loser's
 * escrowed stake into the winner's available balance plus a platform fee
 * leg — two wallets, one transaction). This function resolves that by
 * treating wallet_id as "the primary wallet for this transaction row" —
 * the first wallet appearing in a debit leg (the wallet funds are actually
 * leaving), falling back to the first wallet touched at all for a
 * pure-credit transfer (e.g. an admin bonus grant with no debit leg other
 * than the platform account). The actual multi-wallet money movement is
 * fully captured in wallet_ledger regardless of this choice — see
 * repository.ts's listTransactions, which joins through wallet_ledger
 * rather than filtering on wallet_transactions.wallet_id directly, so a
 * transaction correctly appears in EVERY affected wallet's history, not
 * just the "primary" one.
 */
function resolvePrimaryWalletId(request: TransferRequest): string {
  const debitWallet = request.legs.find((l) => l.direction === "debit" && l.walletId !== null)?.walletId;
  if (debitWallet) return debitWallet;

  const anyWallet = request.legs.find((l) => l.walletId !== null)?.walletId;
  if (!anyWallet) {
    throw new WalletError("A transfer must touch at least one real wallet (not only platform accounts).");
  }
  return anyWallet;
}

export async function postBalancedEntries(request: TransferRequest): Promise<TransferResult> {
  if (request.legs.length === 0) {
    throw new WalletError("A transfer must include at least one ledger leg.");
  }

  const netDebits = request.legs.filter((l) => l.direction === "debit").reduce((s, l) => s + l.amountCents, 0);
  const netCredits = request.legs.filter((l) => l.direction === "credit").reduce((s, l) => s + l.amountCents, 0);

  if (netDebits !== netCredits) {
    throw new WalletError(
      `Unbalanced ledger request: debits=${netDebits} credits=${netCredits}. Every transfer must net to zero (this is also enforced at commit by the deferred constraint trigger from DB-001 migration 0011 — this check just fails fast with a clearer error before opening a transaction).`,
    );
  }

  const primaryWalletId = resolvePrimaryWalletId(request);
  const transactionAmount = netCredits; // == netDebits, already validated equal above

  return withTransaction(async (sql) => {
    // Row-lock every distinct wallet touched, in a stable sorted order, to
    // prevent a lock-ordering deadlock between two concurrent transfers
    // touching the same two wallets in opposite order — this phase's
    // explicit "double spending / race conditions" protection requirement.
    const walletIds = [...new Set(request.legs.map((l) => l.walletId).filter((id): id is string => id !== null))].sort();

    for (const walletId of walletIds) {
      await sql`select id from wallets where id = ${walletId} for update`;
    }

    // Re-validate available funds for every debit leg AFTER acquiring the
    // lock — never trust a balance read taken before the lock, which is
    // exactly the TOCTOU race this lock exists to close.
    for (const leg of request.legs) {
      if (leg.direction !== "debit" || leg.walletId === null) continue;

      const [row] = await sql<{ balance: string }[]>`
        select coalesce(sum(case direction when 'credit' then amount_cents when 'debit' then -amount_cents end), 0) as balance
        from wallet_ledger
        where wallet_id = ${leg.walletId} and account_type = ${leg.accountType}
      `;
      const currentBalance = Number(row?.balance ?? 0);
      if (currentBalance < leg.amountCents) {
        throw new ConflictError(
          `Insufficient ${leg.accountType} balance on wallet ${leg.walletId}: has ${currentBalance} cents, needs ${leg.amountCents} cents.`,
        );
      }
    }

    const [txRow] = await sql<{ id: string; status: string }[]>`
      insert into wallet_transactions (
        wallet_id, type, status, amount_cents, initiated_by,
        related_challenge_id, related_tournament_id, release_reason, idempotency_key
      )
      values (
        ${primaryWalletId},
        ${request.type},
        'completed',
        ${transactionAmount},
        ${request.initiatedBy},
        ${request.relatedEntity?.table === "challenges" ? request.relatedEntity.id : null},
        ${request.relatedEntity?.table === "tournaments" ? request.relatedEntity.id : null},
        ${request.releaseReason ?? null},
        ${request.idempotencyKey ?? null}
      )
      returning id, status
    `;

    for (const leg of request.legs) {
      await sql`
        insert into wallet_ledger (wallet_transaction_id, wallet_id, account_type, direction, amount_cents)
        values (${txRow.id}, ${leg.walletId}, ${leg.accountType}, ${leg.direction}, ${leg.amountCents})
      `;
    }

    return { transactionId: txRow.id, status: txRow.status as TransferResult["status"] };
  });
}
