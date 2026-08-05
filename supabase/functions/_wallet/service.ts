// supabase/functions/_wallet/service.ts

import { getServiceRoleClient } from "../_shared/database/client.ts";
import { ConflictError, WalletError } from "../_shared/errors/index.ts";
import { recordAudit } from "../_shared/audit/index.ts";
import { emit } from "../_shared/events/index.ts";
import { findWalletByUserId, getWalletByUserIdOrThrow } from "./repository.ts";
import type { WalletBalances } from "./types.ts";

/**
 * Creates a wallet for a user, idempotently. In normal operation this never
 * runs — AUTH-001's `fn_handle_new_user()` trigger already creates a $0
 * wallet at registration (Business Rules §2). This function exists for the
 * genuine edge cases this phase's "Wallet Creation" feature implies: a
 * support/admin recovery path if a wallet row was somehow lost, or a future
 * migration backfilling wallets for accounts created before the trigger
 * existed. It is NOT part of the normal registration flow.
 */
export async function createWalletIfMissing(
  userId: string,
  actorId: string | null,
): Promise<WalletBalances> {
  const existing = await findWalletByUserId(userId);
  if (existing) return existing;

  const supabase = getServiceRoleClient();
  const { data, error } = await supabase
    .from("wallets")
    .insert({ user_id: userId })
    .select("*")
    .single();

  if (error) {
    // Unique-violation race: another request created it between our check
    // and this insert. Re-fetch rather than treating this as a hard failure.
    const raceWinner = await findWalletByUserId(userId);
    if (raceWinner) return raceWinner;
    throw new Error(
      `Failed to create wallet for user ${userId}: ${error.message}`,
    );
  }

  await recordAudit({
    actorId,
    actorType: actorId ? "administrator" : "system",
    action: "WalletCreated",
    category: "financial",
    targetTable: "wallets",
    targetId: data.id,
    metadata: { user_id: userId },
  });

  await emit({
    type: "WalletCreated",
    payload: { walletId: data.id, userId },
    emittedBy: "wallet-create",
  });

  return {
    walletId: data.id,
    userId: data.user_id,
    status: data.status,
    currency: data.currency,
    availableCents: data.available_cents,
    escrowedCents: data.escrowed_cents,
    pendingCents: data.pending_cents,
    bonusCents: data.bonus_cents,
    referralCents: data.referral_cents,
  };
}

export function getBalance(userId: string): Promise<WalletBalances> {
  return getWalletByUserIdOrThrow(userId);
}

/**
 * Freezes a wallet — used by the reconciliation engine when a mismatch is
 * detected (Business Rules §15: "divergence freezes the affected wallet
 * pending manual review, safety-first, not silent auto-correction") and
 * available as an administrative action.
 */
export async function freezeWallet(
  walletId: string,
  reason: string,
  actorId: string | null,
): Promise<void> {
  const supabase = getServiceRoleClient();
  const { error } = await supabase.from("wallets").update({ status: "frozen" })
    .eq("id", walletId);
  if (error) {
    throw new Error(`Failed to freeze wallet ${walletId}: ${error.message}`);
  }

  await recordAudit({
    actorId,
    actorType: actorId ? "administrator" : "system",
    action: "WalletFrozen",
    category: "financial",
    targetTable: "wallets",
    targetId: walletId,
    metadata: { reason },
  });

  await emit({
    type: "WalletUpdated",
    payload: { walletId, status: "frozen", reason },
    emittedBy: "wallet-service",
  });
}

export async function unfreezeWallet(
  walletId: string,
  actorId: string,
): Promise<void> {
  const supabase = getServiceRoleClient();
  const { data: wallet } = await supabase.from("wallets").select("status").eq(
    "id",
    walletId,
  ).maybeSingle();

  if (!wallet || wallet.status !== "frozen") {
    throw new ConflictError(`Wallet ${walletId} is not currently frozen.`);
  }

  const { error } = await supabase.from("wallets").update({ status: "active" })
    .eq("id", walletId);
  if (error) {
    throw new Error(`Failed to unfreeze wallet ${walletId}: ${error.message}`);
  }

  await recordAudit({
    actorId,
    actorType: "administrator",
    action: "WalletUnfrozen",
    category: "financial",
    targetTable: "wallets",
    targetId: walletId,
  });

  await emit({
    type: "WalletUpdated",
    payload: { walletId, status: "active" },
    emittedBy: "wallet-service",
  });
}

/**
 * "Wallet Closure" per Business Rules §2 is blocked while non-zero balance
 * or non-terminal challenges exist — this function enforces the balance
 * half of that rule; the challenge-state half belongs to the Challenge
 * Engine (a future phase), which should call this only after confirming
 * that side is clear.
 */
export async function closeWallet(
  walletId: string,
  actorId: string | null,
): Promise<void> {
  const wallet = await getWalletBalanceById(walletId);

  const totalCents = wallet.availableCents + wallet.escrowedCents +
    wallet.pendingCents + wallet.bonusCents + wallet.referralCents;
  if (totalCents !== 0) {
    throw new WalletError(
      `Cannot close wallet ${walletId}: non-zero balance remains (${totalCents} cents across all sub-balances). Withdraw or otherwise clear funds first.`,
    );
  }

  const supabase = getServiceRoleClient();
  const { error } = await supabase.from("wallets").update({ status: "frozen" })
    .eq("id", walletId);
  // Closure reuses 'frozen' status rather than adding a third wallet_status
  // enum value — DB-001's wallet_status is deliberately just
  // active/frozen, and account-level closure is already tracked on
  // profiles.status (closed_at), which is the actual source of truth for
  // "this account is closed." A frozen wallet on a closed account is
  // functionally identical to a dedicated "closed" wallet status would be.
  if (error) {
    throw new Error(`Failed to close wallet ${walletId}: ${error.message}`);
  }

  await recordAudit({
    actorId,
    actorType: actorId ? "administrator" : "user",
    action: "WalletClosed",
    category: "financial",
    targetTable: "wallets",
    targetId: walletId,
  });
}

async function getWalletBalanceById(walletId: string): Promise<WalletBalances> {
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase.from("wallets").select("*").eq(
    "id",
    walletId,
  ).maybeSingle();
  if (error || !data) throw new WalletError(`Wallet ${walletId} not found.`);
  return {
    walletId: data.id,
    userId: data.user_id,
    status: data.status,
    currency: data.currency,
    availableCents: data.available_cents,
    escrowedCents: data.escrowed_cents,
    pendingCents: data.pending_cents,
    bonusCents: data.bonus_cents,
    referralCents: data.referral_cents,
  };
}
