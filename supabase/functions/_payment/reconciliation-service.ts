// supabase/functions/_payment/reconciliation-service.ts
// Compares local payment_intents against the provider's own transaction
// status, catching drift (e.g. a webhook that never arrived, leaving an
// intent stuck 'pending' when the provider actually completed it).

import { getServiceRoleClient } from "../_shared/database/client.ts";
import { logger } from "../_shared/logger/index.ts";
import { getActiveProvider } from "./registry.ts";
import { verifyAndCompleteDeposit } from "./deposit-service.ts";
import { finalizeWithdrawal } from "./withdrawal-service.ts";

export async function reconcilePendingIntents(
  olderThanMinutes = 15,
  limit = 100,
) {
  const supabase = getServiceRoleClient();
  const provider = await getActiveProvider();
  const cutoff = new Date(Date.now() - olderThanMinutes * 60 * 1000)
    .toISOString();

  const { data: pending } = await supabase
    .from("payment_intents")
    .select("*")
    .eq("status", "pending")
    .lt("created_at", cutoff)
    .limit(limit);

  let reconciled = 0;
  const driftFound: string[] = [];

  for (const intent of pending ?? []) {
    try {
      if (intent.kind === "deposit") {
        const verification = await provider.verifyTransaction(
          intent.provider_ref,
        );
        if (verification.status === "success") {
          await verifyAndCompleteDeposit(intent.provider_ref);
          driftFound.push(intent.id);
          reconciled += 1;
        } else if (verification.status === "failed") {
          await supabase.from("payment_intents").update({ status: "failed" })
            .eq("id", intent.id);
          reconciled += 1;
        }
      } else {
        const status = await provider.getTransferStatus(intent.provider_ref);
        if (status.status === "success") {
          await finalizeWithdrawal(intent.provider_ref, "success");
          driftFound.push(intent.id);
          reconciled += 1;
        } else if (status.status === "failed" || status.status === "reversed") {
          await finalizeWithdrawal(intent.provider_ref, "failed");
          driftFound.push(intent.id);
          reconciled += 1;
        }
      }
    } catch (err) {
      logger.error("Reconciliation failed for payment intent", {
        intentId: intent.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { checked: (pending ?? []).length, reconciled, driftFound };
}
