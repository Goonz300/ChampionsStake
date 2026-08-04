// supabase/functions/_payment/withdrawal-service.ts

import { getServiceRoleClient } from "../_shared/database/client.ts";
import { ValidationError, ConflictError, AuthorizationError } from "../_shared/errors/index.ts";
import { recordAudit } from "../_shared/audit/index.ts";
import { emit } from "../_shared/events/index.ts";
import { getWalletByUserIdOrThrow } from "../_wallet/repository.ts";
import { initiateWithdrawalHold, settleWithdrawal, reverseWithdrawalHold } from "../_wallet/transfer.ts";
import { getActiveProvider } from "./registry.ts";

const WITHDRAWAL_MIN_CENTS = 1000;

export async function createPayoutMethod(
  userId: string,
  bankCode: string,
  accountNumber: string,
  accountName: string,
): Promise<{ id: string }> {
  const supabase = getServiceRoleClient();
  const provider = await getActiveProvider();

  const result = await provider.createTransferRecipient({ userId, bankCode, accountNumber, accountName });

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

  if (error || !data) throw new Error(`Failed to save payout method: ${error?.message}`);

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
): Promise<{ intentId: string; providerRef: string }> {
  if (amountCents < WITHDRAWAL_MIN_CENTS) {
    throw new ValidationError(`Withdrawal amount must be at least ${WITHDRAWAL_MIN_CENTS} cents (Business Rules §6).`);
  }

  const supabase = getServiceRoleClient();

  const { data: payoutMethod } = await supabase.from("payout_methods").select("*").eq("id", payoutMethodId).maybeSingle();
  if (!payoutMethod || payoutMethod.user_id !== userId) {
    throw new AuthorizationError("This payout method does not belong to you.");
  }

  const wallet = await getWalletByUserIdOrThrow(userId);

  const { data: pendingIntent } = await supabase
    .from("payment_intents")
    .select("id")
    .eq("wallet_id", wallet.walletId)
    .eq("kind", "withdrawal")
    .eq("status", "pending")
    .maybeSingle();
  if (pendingIntent) {
    throw new ConflictError("You already have a withdrawal in progress. Wait for it to complete before requesting another.");
  }

  const holdResult = await initiateWithdrawalHold(wallet.walletId, amountCents, `${idempotencyKey}-hold`);

  const provider = await getActiveProvider();
  const intentInsert = {
    kind: "withdrawal" as const,
    user_id: userId,
    wallet_id: wallet.walletId,
    provider: provider.name,
    amount_cents: amountCents,
    idempotency_key: idempotencyKey,
    hold_transaction_id: holdResult.transactionId,
    payout_method_id: payoutMethodId,
  };

  try {
    const transfer = await provider.initiateTransfer({
      amountCents,
      currency: "NGN",
      recipientCode: payoutMethod.recipient_code,
      reason: "ChampionsStake withdrawal",
      idempotencyKey,
    });

    const { data: intent, error } = await supabase
      .from("payment_intents")
      .insert({ ...intentInsert, provider_ref: transfer.providerRef })
      .select("id")
      .single();
    if (error || !intent) throw new Error(`Failed to record withdrawal intent: ${error?.message}`);

    await recordAudit({
      actorId: userId,
      actorType: "user",
      action: "WithdrawalRequested",
      category: "financial",
      targetTable: "payment_intents",
      targetId: intent.id,
      metadata: { amountCents, providerRef: transfer.providerRef },
    });
    await emit({ type: "TransactionCompleted", payload: { userId, event: "WithdrawalRequested" }, emittedBy: "payment-transfer" });

    return { intentId: intent.id, providerRef: transfer.providerRef };
  } catch (err) {
    await reverseWithdrawalHold(wallet.walletId, amountCents, "Provider transfer initiation failed", `${idempotencyKey}-reverse`);
    throw err;
  }
}

/** Called by webhook-service.ts once the provider confirms the transfer's
 * final status (never by a client-reported status). */
export async function finalizeWithdrawal(providerRef: string, providerStatus: "success" | "failed"): Promise<void> {
  const supabase = getServiceRoleClient();
  const { data: intent } = await supabase
    .from("payment_intents")
    .select("*")
    .eq("provider_ref", providerRef)
    .eq("kind", "withdrawal")
    .maybeSingle();

  if (!intent) throw new ValidationError(`No withdrawal intent found for provider reference ${providerRef}.`);
  if (intent.status !== "pending") return;

  if (providerStatus === "success") {
    const result = await settleWithdrawal(intent.wallet_id, intent.amount_cents, intent.provider, providerRef, `${providerRef}-settle`);
    await supabase
      .from("payment_intents")
      .update({ status: "completed", resulting_transaction_id: result.transactionId })
      .eq("id", intent.id);
  } else {
    await reverseWithdrawalHold(intent.wallet_id, intent.amount_cents, "Provider transfer failed", `${providerRef}-reverse`);
    await supabase.from("payment_intents").update({ status: "failed" }).eq("id", intent.id);
    await emit({ type: "TransactionFailed", payload: { providerRef, event: "WithdrawalFailed" }, emittedBy: "payment-webhook" });
  }
}
