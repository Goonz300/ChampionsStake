// supabase/functions/_payment/withdrawal-service.ts

import { getServiceRoleClient } from "../_shared/database/client.ts";
import {
  AuthorizationError,
  ConflictError,
  ValidationError,
} from "../_shared/errors/index.ts";
import { recordAudit } from "../_shared/audit/index.ts";
import { emit } from "../_shared/events/index.ts";
import { config } from "../_shared/config/index.ts";
import { getWalletByUserIdOrThrow } from "../_wallet/repository.ts";
import {
  initiateWithdrawalHold,
  reverseWithdrawalHold,
  settleWithdrawal,
} from "../_wallet/transfer.ts";
import { getActiveProvider } from "./registry.ts";
import { assertNotSanctioned } from "./sanctions.ts";

const WITHDRAWAL_MIN_CENTS = 1000;

/**
 * Phase 6: confirmed missing entirely before this fix (grep found no
 * daily/monthly/rolling-window limit anywhere in _payment/). Counts
 * withdrawal-kind payment_intents that are still "live" money commitments
 * -- pending, pending_review, or completed -- within the window; 'failed'/
 * 'expired' intents already returned their hold and don't count against
 * the limit.
 */
async function assertWithinWithdrawalLimits(
  userId: string,
  amountCents: number,
): Promise<void> {
  const supabase = getServiceRoleClient();
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setUTCHours(0, 0, 0, 0);
  const startOfMonth = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  );

  const sumSince = async (since: Date): Promise<number> => {
    const { data } = await supabase
      .from("payment_intents")
      .select("amount_cents")
      .eq("user_id", userId)
      .eq("kind", "withdrawal")
      .in("status", ["pending", "pending_review", "completed"])
      .gte("created_at", since.toISOString());
    return (data ?? []).reduce(
      (sum, row) => sum + (row.amount_cents as number),
      0,
    );
  };

  const [dailyTotal, monthlyTotal] = await Promise.all([
    sumSince(startOfDay),
    sumSince(startOfMonth),
  ]);

  if (dailyTotal + amountCents > config.withdrawal.dailyLimitCents) {
    throw new ValidationError(
      `This withdrawal would exceed your daily withdrawal limit of ${config.withdrawal.dailyLimitCents} cents.`,
    );
  }
  if (monthlyTotal + amountCents > config.withdrawal.monthlyLimitCents) {
    throw new ValidationError(
      `This withdrawal would exceed your monthly withdrawal limit of ${config.withdrawal.monthlyLimitCents} cents.`,
    );
  }
}

export async function createPayoutMethod(
  userId: string,
  bankCode: string,
  accountNumber: string,
  accountName: string,
): Promise<{ id: string }> {
  const supabase = getServiceRoleClient();
  const provider = await getActiveProvider();

  const result = await provider.createTransferRecipient({
    userId,
    bankCode,
    accountNumber,
    accountName,
  });

  // Phase 6: screens the PROVIDER'S resolved account name (the bank-
  // verified identity behind the account), not the client-supplied
  // accountName -- screening only the client-supplied value would be
  // trivially bypassable by typing something innocuous while the real bank
  // account resolves to a blocklisted name.
  await assertNotSanctioned(
    result.resolvedAccountName,
    userId,
    "payout_method_creation",
  );

  const { data, error } = await supabase
    .from("payout_methods")
    .insert({
      user_id: userId,
      provider: provider.name,
      recipient_code: result.recipientCode,
      bank_code: bankCode,
      account_number_last4: result.accountNumberLast4,
      account_name: result.resolvedAccountName,
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`Failed to save payout method: ${error?.message}`);
  }

  await recordAudit({
    actorId: userId,
    actorType: "user",
    action: "PayoutMethodCreated",
    category: "financial",
    targetTable: "payout_methods",
    targetId: data.id,
  });

  return { id: data.id };
}

/**
 * Requests a withdrawal. Wallet balance validation reuses WALLET-001's own
 * balance check inside postBalancedEntries (via initiateWithdrawalHold) —
 * this function does not re-check the balance itself.
 *
 * The hold transaction (available -> pending) is a real, immediately-
 * completed WALLET-001 transaction the instant this function runs — it is
 * NOT later mutated to reflect "waiting on the provider" (DB-001's
 * immutability trigger would reject that). Instead, a payment_intents row
 * (kind='withdrawal') tracks provider-side status separately; see
 * migration 0063's header for the bug this design avoids.
 */
export async function requestWithdrawal(
  userId: string,
  payoutMethodId: string,
  amountCents: number,
  idempotencyKey: string,
): Promise<
  { intentId: string; providerRef: string | null; pendingReview: boolean }
> {
  if (amountCents < WITHDRAWAL_MIN_CENTS) {
    throw new ValidationError(
      `Withdrawal amount must be at least ${WITHDRAWAL_MIN_CENTS} cents (Business Rules §6).`,
    );
  }
  await assertWithinWithdrawalLimits(userId, amountCents);

  const supabase = getServiceRoleClient();

  const { data: payoutMethod } = await supabase.from("payout_methods").select(
    "*",
  ).eq("id", payoutMethodId).maybeSingle();
  if (!payoutMethod || payoutMethod.user_id !== userId) {
    throw new AuthorizationError("This payout method does not belong to you.");
  }

  // Phase 6: re-screens at withdrawal time too, not just at payout-method
  // creation -- catches a name added to the blocklist after this payout
  // method was already on file.
  await assertNotSanctioned(payoutMethod.account_name, userId, "withdrawal");

  const wallet = await getWalletByUserIdOrThrow(userId);

  const { data: pendingIntent } = await supabase
    .from("payment_intents")
    .select("id")
    .eq("wallet_id", wallet.walletId)
    .eq("kind", "withdrawal")
    .in("status", ["pending", "pending_review"])
    .maybeSingle();
  if (pendingIntent) {
    throw new ConflictError(
      "You already have a withdrawal in progress. Wait for it to complete before requesting another.",
    );
  }

  const holdResult = await initiateWithdrawalHold(
    wallet.walletId,
    amountCents,
    `${idempotencyKey}-hold`,
  );

  const provider = await getActiveProvider();
  const intentStatus =
    amountCents >= config.withdrawal.manualReviewThresholdCents
      ? "pending_review" as const
      : "pending" as const;
  const intentInsert = {
    kind: "withdrawal" as const,
    user_id: userId,
    wallet_id: wallet.walletId,
    provider: provider.name,
    amount_cents: amountCents,
    idempotency_key: idempotencyKey,
    hold_transaction_id: holdResult.transactionId,
    payout_method_id: payoutMethodId,
    status: intentStatus,
  };

  // Hostile-review fix: the payment_intents row is now inserted BEFORE any
  // provider call, for BOTH branches below -- not just the pending_review
  // one. uq_payment_intents_one_active_withdrawal_per_wallet (migration
  // 0085) makes "one active withdrawal per wallet" a real database
  // guarantee; inserting first means a losing concurrent request fails
  // HERE, before it could ever reach the payment provider and actually
  // send money. The previous ordering (provider call, then insert) meant
  // two concurrent requests could both pass the earlier application-level
  // pending-intent check, both call the provider, and only THEN have the
  // second one fail at insert time -- by which point real money had
  // already been sent twice.
  const { data: intent, error: insertError } = await supabase
    .from("payment_intents")
    .insert(intentInsert)
    .select("id")
    .single();

  if (insertError || !intent) {
    await reverseWithdrawalHold(
      wallet.walletId,
      amountCents,
      "Failed to record withdrawal intent",
      `${idempotencyKey}-reverse`,
    );
    if (insertError?.code === "23505") {
      throw new ConflictError(
        "You already have a withdrawal in progress. Wait for it to complete before requesting another.",
      );
    }
    throw new Error(
      `Failed to record withdrawal intent: ${insertError?.message}`,
    );
  }

  // Phase 6: funds are already safely on hold (moved to the `pending`
  // sub-balance above) and the intent is durably recorded at this point --
  // a high-value withdrawal is held for administrator review BEFORE the
  // provider transfer call is ever made, rather than reaching out to move
  // real money and only reviewing after the fact.
  if (intentStatus === "pending_review") {
    await recordAudit({
      actorId: userId,
      actorType: "user",
      action: "WithdrawalHeldForReview",
      category: "financial",
      targetTable: "payment_intents",
      targetId: intent.id,
      metadata: {
        amountCents,
        thresholdCents: config.withdrawal.manualReviewThresholdCents,
      },
    });
    await emit({
      type: "TransactionCompleted",
      payload: { userId, event: "WithdrawalHeldForReview" },
      emittedBy: "payment-transfer",
    });

    return { intentId: intent.id, providerRef: null, pendingReview: true };
  }

  try {
    const transfer = await provider.initiateTransfer({
      amountCents,
      currency: "NGN",
      recipientCode: payoutMethod.recipient_code,
      reason: "ChampionsStake withdrawal",
      idempotencyKey,
    });

    const { error: updateError } = await supabase
      .from("payment_intents")
      .update({ provider_ref: transfer.providerRef })
      .eq("id", intent.id);
    if (updateError) {
      throw new Error(
        `Failed to record provider reference: ${updateError.message}`,
      );
    }

    await recordAudit({
      actorId: userId,
      actorType: "user",
      action: "WithdrawalRequested",
      category: "financial",
      targetTable: "payment_intents",
      targetId: intent.id,
      metadata: { amountCents, providerRef: transfer.providerRef },
    });
    await emit({
      type: "TransactionCompleted",
      payload: { userId, event: "WithdrawalRequested" },
      emittedBy: "payment-transfer",
    });

    return {
      intentId: intent.id,
      providerRef: transfer.providerRef,
      pendingReview: false,
    };
  } catch (err) {
    // Hostile-review fix: the payment_intents row now exists (inserted
    // before the provider call, above) by the time this can fail -- it
    // must be marked 'failed' here, not left at 'pending' with no
    // provider_ref. Left uncleaned, it would sit inside
    // uq_payment_intents_one_active_withdrawal_per_wallet's partial index
    // forever, permanently blocking this wallet from ever withdrawing
    // again.
    await supabase.from("payment_intents").update({ status: "failed" }).eq(
      "id",
      intent.id,
    );
    await reverseWithdrawalHold(
      wallet.walletId,
      amountCents,
      "Provider transfer initiation failed",
      `${idempotencyKey}-reverse`,
    );
    throw err;
  }
}

/**
 * Administrator approves a withdrawal held at status='pending_review' --
 * NOW calls the provider transfer (money leaves the platform for the first
 * time at this point, not before). Funds have been on hold since the
 * original request; approval does not touch the wallet ledger itself.
 */
export async function approveHeldWithdrawal(
  intentId: string,
  adminId: string,
): Promise<{ providerRef: string }> {
  const supabase = getServiceRoleClient();

  // Hostile-review fix: this was previously a SELECT, a status check, THEN
  // an UPDATE -- not atomic. Two concurrent approve calls (two admins, or
  // a double-click) could both read status='pending_review' before either
  // UPDATE landed, both call the payment provider, and send money twice.
  // An atomic UPDATE ... WHERE status='pending_review' ... RETURNING (the
  // same claim pattern this codebase already uses elsewhere for an
  // identical class of race, e.g. Phase 3C's recovery-code consumption)
  // means only ONE concurrent caller can ever win the claim; every other
  // caller gets zero rows back and must not proceed to the provider call.
  const { data: claimed, error: claimError } = await supabase
    .from("payment_intents")
    .update({ status: "pending" })
    .eq("id", intentId)
    .eq("kind", "withdrawal")
    .eq("status", "pending_review")
    .select("*")
    .maybeSingle();

  if (claimError) {
    throw new Error(
      `Failed to claim withdrawal intent ${intentId}: ${claimError.message}`,
    );
  }
  if (!claimed) {
    // Either it doesn't exist, or it's not (or no longer) pending_review --
    // including the case where another concurrent call already claimed it.
    const { data: existing } = await supabase
      .from("payment_intents")
      .select("status")
      .eq("id", intentId)
      .eq("kind", "withdrawal")
      .maybeSingle();
    if (!existing) {
      throw new ValidationError(`Withdrawal intent ${intentId} not found.`);
    }
    throw new ConflictError(
      `Withdrawal intent ${intentId} is not awaiting review (status: ${existing.status}).`,
    );
  }

  const { data: payoutMethod } = await supabase
    .from("payout_methods")
    .select("*")
    .eq("id", claimed.payout_method_id)
    .maybeSingle();
  if (!payoutMethod) {
    // Claim already succeeded (status='pending') -- must resolve this one
    // way or another rather than leaving it stuck at 'pending' with no
    // provider_ref, which would also block the wallet's active-withdrawal
    // slot indefinitely (uq_payment_intents_one_active_withdrawal_per_wallet).
    await supabase.from("payment_intents").update({ status: "failed" }).eq(
      "id",
      intentId,
    );
    await reverseWithdrawalHold(
      claimed.wallet_id,
      claimed.amount_cents,
      "Payout method no longer exists",
      `${claimed.idempotency_key}-review-approve-failed`,
    );
    throw new Error(
      `Payout method ${claimed.payout_method_id} no longer exists.`,
    );
  }

  try {
    const provider = await getActiveProvider();
    const transfer = await provider.initiateTransfer({
      amountCents: claimed.amount_cents,
      currency: "NGN",
      recipientCode: payoutMethod.recipient_code,
      reason: "ChampionsStake withdrawal (reviewed)",
      idempotencyKey: claimed.idempotency_key,
    });

    await supabase
      .from("payment_intents")
      .update({ provider_ref: transfer.providerRef })
      .eq("id", intentId);

    await recordAudit({
      actorId: adminId,
      actorType: "administrator",
      action: "WithdrawalReviewApproved",
      category: "financial",
      targetTable: "payment_intents",
      targetId: intentId,
      metadata: { providerRef: transfer.providerRef },
    });

    return { providerRef: transfer.providerRef };
  } catch (err) {
    // Same reasoning as requestWithdrawal's own catch: the claim already
    // moved this row to 'pending' -- a failure here must not leave it
    // stuck there.
    await supabase.from("payment_intents").update({ status: "failed" }).eq(
      "id",
      intentId,
    );
    await reverseWithdrawalHold(
      claimed.wallet_id,
      claimed.amount_cents,
      "Provider transfer initiation failed after review approval",
      `${claimed.idempotency_key}-review-approve-failed`,
    );
    throw err;
  }
}

/**
 * Administrator rejects a withdrawal held at status='pending_review' --
 * reverses the hold (funds return to `available`) and marks the intent
 * failed. No provider call is ever made for a rejected withdrawal.
 */
export async function rejectHeldWithdrawal(
  intentId: string,
  adminId: string,
  reason: string,
): Promise<void> {
  const supabase = getServiceRoleClient();

  // Hostile-review fix: same atomic-claim reasoning as approveHeldWithdrawal
  // -- without this, a reject racing a concurrent approve could both read
  // status='pending_review', and the reject could reverse a hold whose
  // funds the approve had already sent to the payment provider.
  const { data: claimed, error: claimError } = await supabase
    .from("payment_intents")
    .update({ status: "failed" })
    .eq("id", intentId)
    .eq("kind", "withdrawal")
    .eq("status", "pending_review")
    .select("*")
    .maybeSingle();

  if (claimError) {
    throw new Error(
      `Failed to claim withdrawal intent ${intentId}: ${claimError.message}`,
    );
  }
  if (!claimed) {
    const { data: existing } = await supabase
      .from("payment_intents")
      .select("status")
      .eq("id", intentId)
      .eq("kind", "withdrawal")
      .maybeSingle();
    if (!existing) {
      throw new ValidationError(`Withdrawal intent ${intentId} not found.`);
    }
    throw new ConflictError(
      `Withdrawal intent ${intentId} is not awaiting review (status: ${existing.status}).`,
    );
  }

  await reverseWithdrawalHold(
    claimed.wallet_id,
    claimed.amount_cents,
    `Rejected by administrator: ${reason}`,
    `${claimed.idempotency_key}-review-reject`,
  );

  await recordAudit({
    actorId: adminId,
    actorType: "administrator",
    action: "WithdrawalReviewRejected",
    category: "financial",
    targetTable: "payment_intents",
    targetId: intentId,
    metadata: { reason },
  });
}

/** Called by webhook-service.ts once the provider confirms the transfer's
 * final status (never by a client-reported status). */
export async function finalizeWithdrawal(
  providerRef: string,
  providerStatus: "success" | "failed",
): Promise<void> {
  const supabase = getServiceRoleClient();
  const { data: intent } = await supabase
    .from("payment_intents")
    .select("*")
    .eq("provider_ref", providerRef)
    .eq("kind", "withdrawal")
    .maybeSingle();

  if (!intent) {
    throw new ValidationError(
      `No withdrawal intent found for provider reference ${providerRef}.`,
    );
  }
  if (intent.status !== "pending") return;

  if (providerStatus === "success") {
    const result = await settleWithdrawal(
      intent.wallet_id,
      intent.amount_cents,
      intent.provider,
      providerRef,
      `${providerRef}-settle`,
    );
    await supabase
      .from("payment_intents")
      .update({
        status: "completed",
        resulting_transaction_id: result.transactionId,
      })
      .eq("id", intent.id);
  } else {
    await reverseWithdrawalHold(
      intent.wallet_id,
      intent.amount_cents,
      "Provider transfer failed",
      `${providerRef}-reverse`,
    );
    await supabase.from("payment_intents").update({ status: "failed" }).eq(
      "id",
      intent.id,
    );
    await emit({
      type: "TransactionFailed",
      payload: { providerRef, event: "WithdrawalFailed" },
      emittedBy: "payment-webhook",
    });
  }
}
