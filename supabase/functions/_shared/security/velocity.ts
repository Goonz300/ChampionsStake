// supabase/functions/_shared/security/velocity.ts
//
// Layer 6 (Velocity Detection): behavioral fraud signals, distinct from
// rate limiting (security/rate-limit.ts). Rate limiting REJECTS a request
// once a threshold is crossed; velocity detection FLAGS a pattern for
// moderator review without blocking anything -- matching this codebase's
// existing, hard rule for fraud_flags (see _ai/fraud-detection.ts's header:
// "scores above threshold auto-flag for moderator queue, never auto-block
// funds without human review in v1"). This module writes to the SAME
// fraud_flags table via the SAME dedup-on-open-flag pattern _ai/
// fraud-detection.ts already established, rather than inventing a second
// fraud-signal mechanism.

import { getServiceRoleClient } from "../database/client.ts";

export type VelocitySignal =
  | "challenge_creation"
  | "tournament_registration"
  | "withdrawal";

interface VelocityCheckParams {
  userId: string;
  signal: VelocitySignal;
  /** Count of matching events in the caller's chosen window -- the caller
   * queries its own domain table (challenges, tournament_registrations,
   * payment_intents, ...) since only it knows the right filter; this
   * module doesn't assume a schema. */
  count: number;
  maxCount: number;
  windowSeconds: number;
}

const FLAG_TYPE_BY_SIGNAL: Record<VelocitySignal, string> = {
  // Reuses fraud_flags' existing 'suspicious_withdrawal' enum value
  // (migration 0060), never previously raised by any function (verified by
  // grep before this phase) -- extends it rather than adding a duplicate.
  withdrawal: "suspicious_withdrawal",
  // No pre-existing dedicated type for these -- 'velocity_abuse' (migration
  // 0080), distinguished via details.signal below.
  challenge_creation: "velocity_abuse",
  tournament_registration: "velocity_abuse",
};

/**
 * Raises (or leaves alone, if an identical flag is already open -- same
 * dedup rule as _ai/fraud-detection.ts's raiseFlag) a fraud_flags row when
 * count exceeds maxCount. Score is proportional to how far over the
 * threshold the count is, capped at 100.
 */
export async function checkVelocity(
  params: VelocityCheckParams,
): Promise<{ exceeded: boolean }> {
  if (params.count <= params.maxCount) return { exceeded: false };

  const supabase = getServiceRoleClient();
  const flagType = FLAG_TYPE_BY_SIGNAL[params.signal];

  const { data: existing } = await supabase
    .from("fraud_flags")
    .select("id")
    .eq("flag_type", flagType)
    .eq("primary_user_id", params.userId)
    .eq("status", "open")
    .contains("details", { signal: params.signal })
    .maybeSingle();
  if (existing) return { exceeded: true };

  const overBy = params.count - params.maxCount;
  const score = Math.min(100, 50 + overBy * 10);

  await supabase.from("fraud_flags").insert({
    flag_type: flagType,
    primary_user_id: params.userId,
    score,
    details: {
      signal: params.signal,
      count: params.count,
      max_count: params.maxCount,
      window_seconds: params.windowSeconds,
    },
  });

  return { exceeded: true };
}
