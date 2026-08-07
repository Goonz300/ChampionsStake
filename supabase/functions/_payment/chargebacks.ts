// supabase/functions/_payment/chargebacks.ts
//
// Phase 7 (AI-002): see migration 0086's header -- transaction_type has had
// an unused 'chargeback' enum value since migration 0035, and there is no
// live payment-provider chargeback webhook integration. This is the
// administrator-recorded factual log staff use when their provider
// dashboard shows one, matching migration 0084's sanctions-blocklist
// honesty pattern (a real, human-maintained record rather than invented
// automation for a data source this platform doesn't have).

import { getServiceRoleClient } from "../_shared/database/client.ts";
import { recordAudit } from "../_shared/audit/index.ts";
import { emit } from "../_shared/events/index.ts";
import { ConflictError, ValidationError } from "../_shared/errors/index.ts";

export interface RecordChargebackInput {
  userId: string;
  walletTransactionId?: string;
  provider: string;
  providerReference: string;
  amountCents: number;
  reason: string;
  recordedBy: string;
}

export async function recordChargeback(
  input: RecordChargebackInput,
): Promise<{ id: string }> {
  if (input.amountCents <= 0) {
    throw new ValidationError("Chargeback amount must be positive.");
  }

  const supabase = getServiceRoleClient();
  const { data, error } = await supabase
    .from("chargebacks")
    .insert({
      user_id: input.userId,
      wallet_transaction_id: input.walletTransactionId ?? null,
      provider: input.provider,
      provider_reference: input.providerReference,
      amount_cents: input.amountCents,
      reason: input.reason,
      recorded_by: input.recordedBy,
    })
    .select("id")
    .single();

  if (error) {
    // Same "one active/one real record per external reference" pattern
    // established in Phase 6 (uq_payment_intents_one_active_withdrawal_per_wallet):
    // uq_chargebacks_provider_reference prevents the same provider chargeback
    // being recorded twice by two staff members, which would double-penalize
    // the user's trust score.
    if (error.code === "23505") {
      throw new ConflictError(
        `A chargeback for ${input.provider}:${input.providerReference} is already recorded.`,
      );
    }
    throw new Error(`Failed to record chargeback: ${error.message}`);
  }

  await recordAudit({
    actorId: input.recordedBy,
    actorType: "administrator",
    action: "ChargebackRecorded",
    category: "financial",
    targetTable: "chargebacks",
    targetId: data.id,
    metadata: {
      userId: input.userId,
      provider: input.provider,
      amountCents: input.amountCents,
      reason: input.reason,
    },
  });

  await emit({
    type: "ChargebackRecorded",
    payload: { chargebackId: data.id, userId: input.userId },
    emittedBy: "admin-wallets",
  });

  return { id: data.id };
}

export async function listChargebacks(limit = 100) {
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase
    .from("chargebacks")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Failed to list chargebacks: ${error.message}`);
  return data ?? [];
}
