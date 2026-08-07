// supabase/functions/_wallet/types.ts
//
// Domain types for the Wallet Engine. Lives outside _shared deliberately —
// EDGE-001's framework is business-logic-free; everything wallet-specific
// belongs here instead, imported by the 6 wallet-* Edge Functions.

export type LedgerAccountType =
  | "available"
  | "escrowed"
  | "pending"
  | "bonus"
  | "referral"
  | "platform_fee_revenue"
  | "platform_clearing";

export type TransactionType =
  | "deposit"
  | "withdrawal"
  | "stake"
  | "payout"
  | "refund"
  | "fee"
  | "adjustment"
  | "bonus_credit"
  | "bonus_debit"
  | "tournament_entry"
  | "tournament_prize"
  | "chargeback"
  | "season_reward";

export type TransactionStatus =
  | "pending"
  | "processing"
  | "completed"
  | "cancelled"
  | "failed"
  | "reversed"
  | "refunded"
  | "expired";

export interface WalletBalances {
  walletId: string;
  userId: string;
  status: "active" | "frozen";
  currency: string;
  availableCents: number;
  escrowedCents: number;
  pendingCents: number;
  bonusCents: number;
  referralCents: number;
}

/**
 * One leg of a double-entry posting. `postBalancedEntries` (ledger.ts)
 * requires every call's leg array to sum to zero net (debits === credits)
 * — this type alone doesn't enforce that; the deferred Postgres constraint
 * trigger from DB-001 migration 0011/0012 is the actual enforcement, this
 * is just the shape the ledger engine builds up before inserting.
 */
export interface LedgerLeg {
  walletId: string | null; // null only for the two singleton platform accounts
  accountType: LedgerAccountType;
  direction: "debit" | "credit";
  amountCents: number;
}

export interface RelatedEntityRef {
  table: "challenges" | "tournaments";
  id: string;
}

export interface TransferRequest {
  type: TransactionType;
  legs: LedgerLeg[];
  initiatedBy: string | null; // profile id, or null for a system-triggered transfer
  relatedEntity?: RelatedEntityRef;
  releaseReason?:
    | "mutual_release"
    | "moderator_decision"
    | "auto_expiry"
    | "refund_void";
  idempotencyKey?: string;
}

export interface TransferResult {
  transactionId: string;
  status: TransactionStatus;
}
