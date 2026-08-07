// supabase/functions/_wallet/transfer.ts
//
// SCOPE BOUNDARY (read this before extending): this file provides generic,
// low-level money-movement primitives. It does NOT decide *when* an escrow
// lock or tournament prize payout should happen — that's the Challenge/
// Escrow/Tournament Engine's job (future phases, explicitly out of scope
// here per "Do NOT implement escrow locking... tournament payouts"). Those
// future engines will call `lockToEscrow`/`releaseFromEscrow` below at the
// right moment in their own state machines; this file only guarantees that
// when they do, the money moves correctly, atomically, and audibly.

import { postBalancedEntries } from "./ledger.ts";
import { recordAudit } from "../_shared/audit/index.ts";
import { emit } from "../_shared/events/index.ts";
import { WalletError } from "../_shared/errors/index.ts";
import { recordEscrowLock, recordEscrowRelease } from "./escrow-accounts.ts";
import type {
  LedgerLeg,
  RelatedEntityRef,
  TransactionType,
  TransferResult,
} from "./types.ts";

async function execute(
  legs: LedgerLeg[],
  type: TransactionType,
  initiatedBy: string | null,
  auditAction: string,
  relatedEntity?: RelatedEntityRef,
  idempotencyKey?: string,
): Promise<TransferResult> {
  const result = await postBalancedEntries({
    type,
    legs,
    initiatedBy,
    relatedEntity,
    idempotencyKey,
  });

  const walletIds = [
    ...new Set(
      legs.map((l) => l.walletId).filter((id): id is string => id !== null),
    ),
  ];

  await recordAudit({
    actorId: initiatedBy,
    actorType: initiatedBy ? "user" : "system",
    action: auditAction,
    category: "financial",
    targetTable: "wallet_transactions",
    targetId: result.transactionId,
    metadata: { wallet_ids: walletIds, related_entity: relatedEntity },
  });

  for (const walletId of walletIds) {
    await emit({
      type: "TransactionCompleted",
      payload: { walletId, transactionId: result.transactionId, type },
      emittedBy: "wallet-transfer",
    });
    await emit({
      type: "BalanceChanged",
      payload: { walletId, transactionId: result.transactionId },
      emittedBy: "wallet-transfer",
    });
  }

  return result;
}

/** Moves funds between two wallets' `available` sub-balance (e.g. a
 * peer-to-peer transfer, or a future feature paying out referral credit). */
export function walletToWallet(
  fromWalletId: string,
  toWalletId: string,
  amountCents: number,
  initiatedBy: string | null,
  idempotencyKey?: string,
): Promise<TransferResult> {
  if (fromWalletId === toWalletId) {
    throw new WalletError("Cannot transfer a wallet to itself.");
  }

  return execute(
    [
      {
        walletId: fromWalletId,
        accountType: "available",
        direction: "debit",
        amountCents,
      },
      {
        walletId: toWalletId,
        accountType: "available",
        direction: "credit",
        amountCents,
      },
    ],
    "adjustment",
    initiatedBy,
    "WalletToWalletTransfer",
    undefined,
    idempotencyKey,
  );
}

/**
 * Moves funds from a wallet's `available` sub-balance into its OWN
 * `escrowed` sub-balance. This is the low-level primitive the Challenge
 * Engine's "publish"/"accept" actions will call — this function has no
 * opinion about challenges, stakes, or when locking should happen.
 *
 * Also records the lock against escrow_accounts/escrow_transactions
 * (Phase 6 fix — see escrow-accounts.ts's header comment) since this is the
 * one choke point every escrow lock, for both challenges and tournaments,
 * already passes through.
 */
export async function lockToEscrow(
  walletId: string,
  amountCents: number,
  relatedEntity: RelatedEntityRef,
  initiatedBy: string | null,
  idempotencyKey?: string,
): Promise<TransferResult> {
  const result = await execute(
    [
      { walletId, accountType: "available", direction: "debit", amountCents },
      { walletId, accountType: "escrowed", direction: "credit", amountCents },
    ],
    "stake",
    initiatedBy,
    "EscrowLockedFromWallet",
    relatedEntity,
    idempotencyKey,
  );

  await recordEscrowLock(
    relatedEntity,
    result.transactionId,
    amountCents,
    initiatedBy,
  );

  return result;
}

/**
 * Moves funds from a wallet's `escrowed` sub-balance back to its own
 * `available` sub-balance (e.g. a cancellation refund) OR to a DIFFERENT
 * wallet's `available` sub-balance (e.g. a winner payout), optionally
 * carving off a platform fee leg. Like lockToEscrow, this has no opinion
 * about *why* — the Escrow Engine decides that and calls this with the
 * right legs.
 */
export async function releaseFromEscrow(
  fromWalletId: string,
  toWalletId: string,
  amountCents: number,
  feeCents: number,
  releaseReason:
    | "mutual_release"
    | "moderator_decision"
    | "auto_expiry"
    | "refund_void",
  relatedEntity: RelatedEntityRef,
  initiatedBy: string | null,
  idempotencyKey?: string,
): Promise<TransferResult> {
  if (feeCents >= amountCents) {
    throw new WalletError(
      "Platform fee cannot be greater than or equal to the released amount.",
    );
  }

  const legs: LedgerLeg[] = [
    {
      walletId: fromWalletId,
      accountType: "escrowed",
      direction: "debit",
      amountCents,
    },
    {
      walletId: toWalletId,
      accountType: "available",
      direction: "credit",
      amountCents: amountCents - feeCents,
    },
  ];

  if (feeCents > 0) {
    legs.push({
      walletId: null,
      accountType: "platform_fee_revenue",
      direction: "credit",
      amountCents: feeCents,
    });
  }

  const result = await postBalancedEntries({
    type: "payout",
    legs,
    initiatedBy,
    relatedEntity,
    releaseReason,
    idempotencyKey,
  });

  // Phase 6 fix — see escrow-accounts.ts's header comment.
  await recordEscrowRelease(
    relatedEntity,
    result.transactionId,
    amountCents,
    initiatedBy,
    releaseReason,
    toWalletId,
  );

  await recordAudit({
    actorId: initiatedBy,
    actorType: initiatedBy ? "user" : "system",
    action: "EscrowReleasedToWallet",
    category: "financial",
    targetTable: "wallet_transactions",
    targetId: result.transactionId,
    metadata: {
      fromWalletId,
      toWalletId,
      amountCents,
      feeCents,
      releaseReason,
      relatedEntity,
    },
  });

  for (const walletId of [fromWalletId, toWalletId]) {
    await emit({
      type: "TransactionCompleted",
      payload: { walletId, transactionId: result.transactionId },
      emittedBy: "wallet-transfer",
    });
    await emit({
      type: "BalanceChanged",
      payload: { walletId },
      emittedBy: "wallet-transfer",
    });
  }

  return result;
}

/** Platform-funded credit into a wallet (e.g. a promotional bonus). */
export function platformToWallet(
  toWalletId: string,
  amountCents: number,
  type: "bonus_credit" | "tournament_prize",
  initiatedBy: string | null,
  idempotencyKey?: string,
): Promise<TransferResult> {
  const accountType = type === "bonus_credit" ? "bonus" : "available";

  return execute(
    [
      {
        walletId: null,
        accountType: "platform_clearing",
        direction: "debit",
        amountCents,
      },
      { walletId: toWalletId, accountType, direction: "credit", amountCents },
    ],
    type,
    initiatedBy,
    "PlatformCreditIssued",
    undefined,
    idempotencyKey,
  );
}

/**
 * Administrative adjustment — the four-eyes-controlled path (Business
 * Rules §11). This function performs the actual ledger movement; the
 * dual-approval workflow itself is enforced by the wallet-adjustment Edge
 * Function (which only calls this once a SECOND, different administrator
 * has confirmed — see that function's own file for the two-step flow).
 */
export async function administrativeAdjustment(
  walletId: string,
  amountCents: number,
  direction: "credit" | "debit",
  reason: string,
  approvedByAdminIds: [string, string],
  idempotencyKey?: string,
): Promise<TransferResult> {
  const legs: LedgerLeg[] = direction === "credit"
    ? [
      {
        walletId: null,
        accountType: "platform_clearing",
        direction: "debit",
        amountCents,
      },
      { walletId, accountType: "available", direction: "credit", amountCents },
    ]
    : [
      { walletId, accountType: "available", direction: "debit", amountCents },
      {
        walletId: null,
        accountType: "platform_clearing",
        direction: "credit",
        amountCents,
      },
    ];

  const result = await postBalancedEntries({
    type: "adjustment",
    legs,
    initiatedBy: approvedByAdminIds[1],
    idempotencyKey,
  });

  await recordAudit({
    actorId: approvedByAdminIds[1],
    actorType: "administrator",
    action: "AdminWalletAdjustment",
    category: "financial",
    targetTable: "wallet_transactions",
    targetId: result.transactionId,
    metadata: {
      walletId,
      amountCents,
      direction,
      reason,
      proposedBy: approvedByAdminIds[0],
      approvedBy: approvedByAdminIds[1],
    },
  });

  await emit({
    type: "TransactionCompleted",
    payload: { walletId, transactionId: result.transactionId },
    emittedBy: "wallet-adjustment",
  });
  await emit({
    type: "BalanceChanged",
    payload: { walletId },
    emittedBy: "wallet-adjustment",
  });

  return result;
}

/**
 * PAYMENT-001 primitives: credit/debit a wallet from an external payment
 * provider. Added here (not duplicated in the Payment Layer) because
 * PAYMENT-001's own brief requires "Wallet remains the source of truth...
 * Payment Layer only communicates with providers" — these three functions
 * ARE that boundary. The Payment Layer calls these; it never touches
 * wallet_ledger/wallet_transactions directly.
 */

/** Credits available balance once a deposit is verified with the provider
 * (never before — "wallet credits must ONLY occur after successful backend
 * verification", PAYMENT-001). */
export async function completeDeposit(
  walletId: string,
  amountCents: number,
  provider: string,
  providerRef: string,
  idempotencyKey: string,
): Promise<TransferResult> {
  const result = await postBalancedEntries({
    type: "deposit",
    legs: [
      {
        walletId: null,
        accountType: "platform_clearing",
        direction: "debit",
        amountCents,
      },
      { walletId, accountType: "available", direction: "credit", amountCents },
    ],
    initiatedBy: null,
    idempotencyKey,
  });

  await recordAudit({
    actorId: null,
    actorType: "system",
    action: "DepositCompleted",
    category: "financial",
    targetTable: "wallet_transactions",
    targetId: result.transactionId,
    metadata: { walletId, amountCents, provider, providerRef },
  });
  await emit({
    type: "TransactionCompleted",
    payload: { walletId, transactionId: result.transactionId, type: "deposit" },
    emittedBy: "payment-webhook",
  });
  await emit({
    type: "BalanceChanged",
    payload: { walletId },
    emittedBy: "payment-webhook",
  });

  return result;
}

/**
 * Withdrawal, step 1: moves the requested amount from `available` to
 * `pending` (a hold) — funds leave the user's spendable balance the moment
 * a withdrawal is requested, before the provider transfer is even
 * attempted, so the same money can't be spent twice while a transfer is
 * in flight.
 */
export async function initiateWithdrawalHold(
  walletId: string,
  amountCents: number,
  idempotencyKey: string,
): Promise<TransferResult> {
  const result = await postBalancedEntries({
    type: "withdrawal",
    legs: [
      { walletId, accountType: "available", direction: "debit", amountCents },
      { walletId, accountType: "pending", direction: "credit", amountCents },
    ],
    initiatedBy: null,
    idempotencyKey,
  });

  await emit({
    type: "TransactionCompleted",
    payload: {
      walletId,
      transactionId: result.transactionId,
      type: "withdrawal_hold",
    },
    emittedBy: "payment-transfer",
  });
  return result;
}

/** Withdrawal, step 2a (success path): extinguishes the pending hold —
 * the money has now genuinely left the platform via the provider transfer. */
export async function settleWithdrawal(
  walletId: string,
  amountCents: number,
  provider: string,
  providerRef: string,
  idempotencyKey: string,
): Promise<TransferResult> {
  const result = await postBalancedEntries({
    type: "withdrawal",
    legs: [
      { walletId, accountType: "pending", direction: "debit", amountCents },
      {
        walletId: null,
        accountType: "platform_clearing",
        direction: "credit",
        amountCents,
      },
    ],
    initiatedBy: null,
    idempotencyKey,
  });

  await recordAudit({
    actorId: null,
    actorType: "system",
    action: "WithdrawalCompleted",
    category: "financial",
    targetTable: "wallet_transactions",
    targetId: result.transactionId,
    metadata: { walletId, amountCents, provider, providerRef },
  });
  await emit({
    type: "TransactionCompleted",
    payload: {
      walletId,
      transactionId: result.transactionId,
      type: "withdrawal_settled",
    },
    emittedBy: "payment-webhook",
  });
  await emit({
    type: "BalanceChanged",
    payload: { walletId },
    emittedBy: "payment-webhook",
  });

  return result;
}

/** Withdrawal, step 2b (failure path): releases the hold back to
 * `available` — the provider transfer failed, so the user's funds return
 * to their spendable balance rather than vanishing into `pending` forever. */
export async function reverseWithdrawalHold(
  walletId: string,
  amountCents: number,
  reason: string,
  idempotencyKey: string,
): Promise<TransferResult> {
  const result = await postBalancedEntries({
    type: "withdrawal",
    legs: [
      { walletId, accountType: "pending", direction: "debit", amountCents },
      { walletId, accountType: "available", direction: "credit", amountCents },
    ],
    initiatedBy: null,
    idempotencyKey,
  });

  await recordAudit({
    actorId: null,
    actorType: "system",
    action: "WithdrawalFailed",
    category: "financial",
    targetTable: "wallet_transactions",
    targetId: result.transactionId,
    metadata: { walletId, amountCents, reason },
  });
  await emit({
    type: "TransactionCompleted",
    payload: {
      walletId,
      transactionId: result.transactionId,
      type: "withdrawal_reversed",
    },
    emittedBy: "payment-webhook",
  });
  await emit({
    type: "BalanceChanged",
    payload: { walletId },
    emittedBy: "payment-webhook",
  });

  return result;
}
