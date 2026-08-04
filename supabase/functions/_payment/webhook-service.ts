// supabase/functions/_payment/webhook-service.ts
//
// This is the ONE place a provider's async confirmation reaches the
// system. Per this phase's explicit security rules: "validate all webhook
// signatures... never trust frontend payment status... wallet credits
// must ONLY occur after successful backend verification" — this function
// verifies the signature, THEN calls verifyAndCompleteDeposit/
// finalizeWithdrawal, which themselves re-verify against the provider's
// API rather than trusting the webhook payload's own claimed status. Two
// layers of verification, not one.

import { getServiceRoleClient } from "../_shared/database/client.ts";
import { ValidationError } from "../_shared/errors/index.ts";
import { recordAudit } from "../_shared/audit/index.ts";
import { getActiveProvider } from "./registry.ts";
import { verifyAndCompleteDeposit } from "./deposit-service.ts";
import { finalizeWithdrawal } from "./withdrawal-service.ts";

export interface WebhookProcessResult {
  status: "processed" | "duplicate" | "ignored";
  eventType?: string;
}

export async function processPaymentWebhook(rawBody: string, signatureHeader: string | null): Promise<WebhookProcessResult> {
  const provider = await getActiveProvider();
  const verification = await provider.verifyWebhookSignature(rawBody, signatureHeader);

  if (!verification.valid) {
    throw new ValidationError("Webhook signature verification failed.");
  }

  const supabase = getServiceRoleClient();

  const { error: insertError } = await supabase.from("processed_payment_webhook_events").insert({
    provider: provider.name,
    provider_event_id: verification.eventId,
    event_type: verification.eventType,
    payload: verification.payload,
  });

  if (insertError) {
    if (insertError.code === "23505") {
      return { status: "duplicate" };
    }
    throw new Error(`Failed to record webhook event: ${insertError.message}`);
  }

  await recordAudit({
    actorId: null,
    actorType: "system",
    action: "WebhookProcessed",
    category: "financial",
    targetTable: "processed_payment_webhook_events",
    targetId: verification.eventId,
    metadata: { provider: provider.name, eventType: verification.eventType },
  });

  const payload = verification.payload as { data?: { reference?: string; status?: string } };
  const reference = payload.data?.reference;

  if (!reference) {
    return { status: "ignored", eventType: verification.eventType };
  }

  if (verification.eventType === "charge.success") {
    await verifyAndCompleteDeposit(reference);
  } else if (verification.eventType === "transfer.success") {
    await finalizeWithdrawal(reference, "success");
  } else if (verification.eventType === "transfer.failed" || verification.eventType === "transfer.reversed") {
    await finalizeWithdrawal(reference, "failed");
  } else {
    return { status: "ignored", eventType: verification.eventType };
  }

  return { status: "processed", eventType: verification.eventType };
}
