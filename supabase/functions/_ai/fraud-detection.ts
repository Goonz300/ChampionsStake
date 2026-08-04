// supabase/functions/_ai/fraud-detection.ts
//
// Business Rules §14/§17: "scores above threshold auto-flag for moderator
// queue, never auto-block funds without human review in v1." Every
// function here only ever INSERTs into fraud_flags -- none of them touch
// wallets, escrow, or challenge status.

import { getServiceRoleClient } from "../_shared/database/client.ts";

const supabase = getServiceRoleClient();

const REPEATED_OPPONENT_THRESHOLD = 5;
const REPEATED_OPPONENT_SCORE = 60;
const MULTI_ACCOUNT_SCORE = 85;

async function raiseFlag(
  flagType: "collusion" | "multi_account" | "repeated_opponent",
  primaryUserId: string,
  secondaryUserId: string | null,
  challengeId: string | null,
  score: number,
  details: Record<string, unknown>,
): Promise<void> {
  let existingQuery = supabase
    .from("fraud_flags")
    .select("id")
    .eq("flag_type", flagType)
    .eq("primary_user_id", primaryUserId)
    .eq("status", "open");
  if (secondaryUserId) existingQuery = existingQuery.eq("secondary_user_id", secondaryUserId);

  const { data: existing } = await existingQuery.maybeSingle();
  if (existing) return;

  await supabase.from("fraud_flags").insert({
    flag_type: flagType,
    primary_user_id: primaryUserId,
    secondary_user_id: secondaryUserId,
    challenge_id: challengeId,
    score,
    details,
  });
}

/** Repeated-opponent / collusion signal (Business Rules §14). */
export async function checkRepeatedOpponent(challengeId: string): Promise<void> {
  const { data: challenge } = await supabase
    .from("challenges")
    .select("creator_id, opponent_id")
    .eq("id", challengeId)
    .maybeSingle();
  if (!challenge?.opponent_id) return;

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data: recentMatches } = await supabase
    .from("challenges")
    .select("id")
    .or(
      `and(creator_id.eq.${challenge.creator_id},opponent_id.eq.${challenge.opponent_id}),and(creator_id.eq.${challenge.opponent_id},opponent_id.eq.${challenge.creator_id})`,
    )
    .gte("created_at", since);

  const matchCount = (recentMatches ?? []).length;
  if (matchCount < REPEATED_OPPONENT_THRESHOLD) return;

  await raiseFlag(
    "repeated_opponent",
    challenge.creator_id,
    challenge.opponent_id,
    challengeId,
    REPEATED_OPPONENT_SCORE,
    { match_count_last_30_days: matchCount },
  );
}

/** Multi-account signal: shared device fingerprint between participants
 * (Business Rules §14). Reuses AUTH-001's devices table directly. */
export async function checkMultiAccount(challengeId: string): Promise<void> {
  const { data: challenge } = await supabase
    .from("challenges")
    .select("creator_id, opponent_id")
    .eq("id", challengeId)
    .maybeSingle();
  if (!challenge?.opponent_id) return;

  const { data: creatorDevices } = await supabase.from("devices").select("device_fingerprint").eq("user_id", challenge.creator_id);
  const { data: opponentDevices } = await supabase
    .from("devices")
    .select("device_fingerprint")
    .eq("user_id", challenge.opponent_id);

  const creatorSet = new Set((creatorDevices ?? []).map((d) => d.device_fingerprint));
  const sharedFingerprints = (opponentDevices ?? [])
    .map((d) => d.device_fingerprint)
    .filter((fp) => creatorSet.has(fp));

  if (sharedFingerprints.length === 0) return;

  await raiseFlag("multi_account", challenge.creator_id, challenge.opponent_id, challengeId, MULTI_ACCOUNT_SCORE, {
    shared_fingerprint_count: sharedFingerprints.length,
  });
}

export async function scanChallenge(challengeId: string): Promise<void> {
  await checkRepeatedOpponent(challengeId);
  await checkMultiAccount(challengeId);
}

export async function sweepRecentChallenges(hours = 24, limit = 200): Promise<{ scanned: number }> {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const { data: challenges } = await supabase
    .from("challenges")
    .select("id")
    .not("opponent_id", "is", null)
    .gte("created_at", since)
    .limit(limit);

  for (const c of challenges ?? []) {
    await scanChallenge(c.id);
  }

  return { scanned: (challenges ?? []).length };
}

export async function reviewFlag(
  flagId: string,
  outcome: "reviewed_cleared" | "reviewed_confirmed",
  reviewerId: string,
): Promise<void> {
  await supabase
    .from("fraud_flags")
    .update({ status: outcome, reviewed_by: reviewerId, reviewed_at: new Date().toISOString() })
    .eq("id", flagId);
}

export async function listFraudFlags(status?: string) {
  let query = supabase.from("fraud_flags").select("*, primary:primary_user_id(display_name)").order("score", { ascending: false });
  if (status) query = query.eq("status", status);
  const { data, error } = await query;
  if (error) throw new Error(`Failed to list fraud flags: ${error.message}`);
  return data ?? [];
}
