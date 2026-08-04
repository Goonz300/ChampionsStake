// supabase/functions/_payment/refund-service.ts
//
// SCOPE NOTE: this phase's brief lists "Refund Architecture" (not "Refund
// Implementation") under the Paystack Provider section. What's built: a
// real call path to Paystack's actual /refund endpoint
// (providers/paystack.ts's initiateRefund is not a stub) and a place to
// record the outcome. What's NOT built: any business logic deciding WHEN a
// refund should happen — this platform's existing refund concept
// (WALLET-001/ESCROW-001's releaseFromEscrow with
// release_reason='refund_void') already handles every in-platform refund
// scenario (cancelled challenges, voided matches, expired tournaments)
// entirely through the internal ledger, with no external payment provider
// involved at all, since that money never left the platform. A
// PROVIDER-level refund (reversing an actual card charge) is only relevant
// for chargebacks/compliance disputes, which is a business-policy decision
// outside this phase's scope to invent.

import { recordAudit } from "../_shared/audit/index.ts";
import { getActiveProvider } from "./registry.ts";

export async function initiateProviderRefund(providerRef: string, amountCents: number, reason: string, adminId: string) {
  const provider = await getActiveProvider();
  const result = await provider.initiateRefund({ providerRef, amountCents, reason });

  await recordAudit({
    actorId: adminId,
    actorType: "administrator",
    action: "RefundInitiated",
    category: "financial",
    targetTable: "payment_intents",
    targetId: providerRef,
    metadata: { amountCents, reason, refundReference: result.refundReference, status: result.status },
  });

  return result;
}
