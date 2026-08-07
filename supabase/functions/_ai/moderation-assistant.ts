// supabase/functions/_ai/moderation-assistant.ts
//
// Phase 7 (AI-006): see migration 0091's header. Assistive only -- never
// writes disputes.priority or any other dispute-lifecycle column, only
// moderation_case_suggestions, a separate table a moderator reads at their
// own discretion.

import { getServiceRoleClient } from "../_shared/database/client.ts";
import {
  computeConfidence,
  computeSuggestedPriority,
  suggestAction,
} from "./moderation-heuristics.ts";

const supabase = getServiceRoleClient();

async function getRiskScore(userId: string): Promise<number | null> {
  const { data } = await supabase
    .from("risk_scores")
    .select("score")
    .eq("subject_type", "player")
    .eq("subject_id", userId)
    .maybeSingle();
  return data ? (data.score as number) : null;
}

async function getHighStakeThresholdCents(): Promise<number> {
  const { data } = await supabase
    .from("system_settings")
    .select("value")
    .eq("key", "kyc_pre_verification_stake_cap_cents")
    .maybeSingle();
  return Number(data?.value ?? 10000);
}

/**
 * Finds an existing cluster among recent open suggestions sharing the same
 * pair of parties -- a simple, explainable "duplicate" definition (the
 * brief's "cluster duplicates" requirement) rather than a similarity model
 * this environment has no training data to build.
 */
async function findOrCreateClusterId(
  creatorId: string,
  opponentId: string | null,
  currentDisputeId: string,
): Promise<string | null> {
  if (!opponentId) return null;

  const { data: disputesForPair } = await supabase
    .from("disputes")
    .select("id, challenge_id")
    .neq("id", currentDisputeId)
    .in("status", ["open", "under_review"]);

  if (!disputesForPair || disputesForPair.length === 0) return null;

  const challengeIds = disputesForPair.map((d) => d.challenge_id);
  const { data: challenges } = await supabase
    .from("challenges")
    .select("id, creator_id, opponent_id")
    .in("id", challengeIds)
    .or(
      `and(creator_id.eq.${creatorId},opponent_id.eq.${opponentId}),and(creator_id.eq.${opponentId},opponent_id.eq.${creatorId})`,
    );

  if (!challenges || challenges.length === 0) return null;

  const matchingDispute = disputesForPair.find((d) =>
    challenges.some((c) => c.id === d.challenge_id)
  );
  if (!matchingDispute) return null;

  const { data: existingSuggestion } = await supabase
    .from("moderation_case_suggestions")
    .select("cluster_id")
    .eq("dispute_id", matchingDispute.id)
    .maybeSingle();

  return existingSuggestion?.cluster_id ?? matchingDispute.id;
}

export interface ModerationSuggestionResult {
  suggestedPriority: string;
  suggestedAction: string;
  confidence: number;
  clusterId: string | null;
}

export async function generateModerationSuggestion(
  disputeId: string,
): Promise<ModerationSuggestionResult> {
  const { data: dispute } = await supabase
    .from("disputes")
    .select("challenge_id")
    .eq("id", disputeId)
    .maybeSingle();
  if (!dispute) throw new Error(`No dispute found for ${disputeId}.`);

  const { data: challenge } = await supabase
    .from("challenges")
    .select("creator_id, opponent_id, stake_cents")
    .eq("id", dispute.challenge_id)
    .maybeSingle();
  if (!challenge) {
    throw new Error(`No challenge found for dispute ${disputeId}.`);
  }

  const [creatorRisk, opponentRisk, highStakeThresholdCents] = await Promise
    .all([
      getRiskScore(challenge.creator_id),
      challenge.opponent_id ? getRiskScore(challenge.opponent_id) : null,
      getHighStakeThresholdCents(),
    ]);

  const partyIds = [challenge.creator_id, challenge.opponent_id].filter((
    id,
  ): id is string => Boolean(id));
  const { count: openFraudFlagCount } = await supabase
    .from("fraud_flags")
    .select("id", { count: "exact", head: true })
    .eq("status", "open")
    .in("primary_user_id", partyIds);

  const { count: evidenceCount } = await supabase
    .from("dispute_evidence")
    .select("id", { count: "exact", head: true })
    .eq("dispute_id", disputeId);

  const maxPartyRiskScore = Math.max(creatorRisk ?? 0, opponentRisk ?? 0);

  const clusterId = await findOrCreateClusterId(
    challenge.creator_id,
    challenge.opponent_id,
    disputeId,
  );

  const suggestedPriority = computeSuggestedPriority({
    maxPartyRiskScore,
    openFraudFlagCount: openFraudFlagCount ?? 0,
    stakeCents: challenge.stake_cents,
    highStakeThresholdCents,
  });

  const suggestedActionText = suggestAction({
    openFraudFlagCount: openFraudFlagCount ?? 0,
    maxPartyRiskScore,
    isRepeatDisputePair: clusterId !== null,
    evidenceCount: evidenceCount ?? 0,
  });

  const confidence = computeConfidence({
    hasRiskScoreForBothParties: creatorRisk !== null &&
      (challenge.opponent_id ? opponentRisk !== null : true),
    hasFraudFlagData: (openFraudFlagCount ?? 0) >= 0, // the query itself always ran; this reflects "we checked", not "we found something"
    evidenceCount: evidenceCount ?? 0,
  });

  const factors = {
    creatorRiskScore: creatorRisk,
    opponentRiskScore: opponentRisk,
    openFraudFlagCount: openFraudFlagCount ?? 0,
    evidenceCount: evidenceCount ?? 0,
    stakeCents: challenge.stake_cents,
    highStakeThresholdCents,
  };

  await supabase.from("moderation_case_suggestions").upsert(
    {
      dispute_id: disputeId,
      suggested_priority: suggestedPriority,
      cluster_id: clusterId,
      suggested_action: suggestedActionText,
      confidence,
      factors,
      generated_at: new Date().toISOString(),
    },
    { onConflict: "dispute_id" },
  );

  return {
    suggestedPriority,
    suggestedAction: suggestedActionText,
    confidence,
    clusterId,
  };
}

/** Sweeps open/under_review disputes without a fresh suggestion. */
export async function sweepModerationSuggestions(
  limit = 100,
): Promise<{ scanned: number }> {
  const { data: disputes } = await supabase
    .from("disputes")
    .select("id")
    .in("status", ["open", "under_review"])
    .limit(limit);

  for (const d of disputes ?? []) {
    await generateModerationSuggestion(d.id);
  }

  return { scanned: (disputes ?? []).length };
}
