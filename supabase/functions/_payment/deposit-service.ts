// supabase/functions/_payment/deposit-service.ts

import { getServiceRoleClient } from "../_shared/database/client.ts";
import { ConflictError, ValidationError } from "../_shared/errors/index.ts";
import { recordAudit } from "../_shared/audit/index.ts";
import { emit } from "../_shared/events/index.ts";
import { completeDeposit } from "../_wallet/transfer.ts";
import { getActiveProvider } from "./registry.ts";

const DEPOSIT_MIN_CENTS = 500;
const DEPOSIT_MAX_CENTS = 200000;

export async function initializeDeposit(
  userId: string,
  amountCents: number,
  idempotencyKey: string,
) {
  if (amountCents < DEPOSIT_MIN_CENTS || amountCents > DEPOSIT_MAX_CENTS) {
    throw new ValidationError(
      `Deposit amount must be between ${DEPOSIT_MIN_CENTS} and ${DEPOSIT_MAX_CENTS} cents (Business Rules §6).`,
    );
  }

  const supabase = getServiceRoleClient();

  const { data: existingIntent } = await supabase
    .from("payment_intents")
    .select("id, provider_ref, status")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (existingIntent) {
    throw new ConflictError(
      `A deposit with idempotency key ${idempotencyKey} already exists (status: ${existingIntent.status}).`,
    );
  }

  const { data: authUser } = await supabase.auth.admin.getUserById(userId);
  const email = authUser?.user?.email;
  const { data: wallet } = await supabase.from("wallets").select("id").eq(
    "user_id",
    userId,
  ).single();
  if (!email || !wallet) {
    throw new ValidationError(
      "User not found, has no email on file, or has no wallet.",
    );
  }

  const provider = await getActiveProvider();
  const result = await provider.initializeTransaction({
    amountCents,
    currency: "NGN",
    userId,
    email,
    idempotencyKey,
  });

  await supabase.from("payment_intents").insert({
    kind: "deposit",
    user_id: userId,
    wallet_id: wallet.id,
    provider: provider.name,
    provider_ref: result.providerRef,
    amount_cents: amountCents,
    idempotency_key: idempotencyKey,
  });

  await recordAudit({
    actorId: userId,
    actorType: "user",
    action: "DepositInitiated",
    category: "financial",
    targetTable: "payment_intents",
    targetId: result.providerRef,
    metadata: { amountCents, provider: provider.name },
  });
  await emit({
    type: "TransactionCompleted",
    payload: {
      userId,
      event: "DepositInitiated",
      providerRef: result.providerRef,
    },
    emittedBy: "payment-initialize",
  });

  return { checkoutUrl: result.checkoutUrl, providerRef: result.providerRef };
}

/**
 * Verifies a deposit directly against the provider (never just trusting a
 * webhook or a client-reported status) — per this phase's explicit "never
 * trust frontend payment status... wallet credits must ONLY occur after
 * successful backend verification" rule. Called by both payment-verify
 * and webhook-service.ts — either caller ends up here, and this function
 * is the only place that decides a deposit succeeded.
 */
export async function verifyAndCompleteDeposit(
  providerRef: string,
): Promise<{ status: string }> {
  const supabase = getServiceRoleClient();
  const provider = await getActiveProvider();

  const { data: intent } = await supabase
    .from("payment_intents")
    .select("*")
    .eq("provider_ref", providerRef)
    .eq("kind", "deposit")
    .maybeSingle();
  if (!intent) {
    throw new ValidationError(
      `No payment intent found for provider reference ${providerRef}.`,
    );
  }
  if (intent.status === "completed") return { status: "already_completed" };
  if (intent.status === "failed") return { status: "already_failed" };

  const verification = await provider.verifyTransaction(providerRef);

  if (verification.status !== "success") {
    await supabase.from("payment_intents").update({ status: "failed" }).eq(
      "id",
      intent.id,
    );
    await emit({
      type: "TransactionFailed",
      payload: { providerRef, event: "DepositFailed" },
      emittedBy: "payment-verify",
    });
    return { status: "failed" };
  }

  if (verification.amountCents !== intent.amount_cents) {
    await supabase.from("payment_intents").update({ status: "failed" }).eq(
      "id",
      intent.id,
    );
    await recordAudit({
      actorId: null,
      actorType: "system",
      action: "DepositAmountMismatch",
      category: "financial",
      targetTable: "payment_intents",
      targetId: intent.id,
      metadata: {
        expected: intent.amount_cents,
        providerConfirmed: verification.amountCents,
      },
    });
    throw new ValidationError(
      `Deposit amount mismatch for ${providerRef}: expected ${intent.amount_cents}, provider confirmed ${verification.amountCents}.`,
    );
  }

  const result = await completeDeposit(
    intent.wallet_id,
    intent.amount_cents,
    provider.name,
    providerRef,
    intent.idempotency_key,
  );

  await supabase
    .from("payment_intents")
    .update({
      status: "completed",
      resulting_transaction_id: result.transactionId,
    })
    .eq("id", intent.id);

  return { status: "completed" };
}
