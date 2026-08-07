// supabase/functions/_ai/recommendations.ts
//
// Reuses CHALLENGE-001's browseChallenges directly for the actual query
// (game/platform/region/stake filters, RLS-safe visibility) -- this file
// only adds the trust-score-band post-filter and KYC-ceiling check
// Business Rules §17 asks for, rather than re-implementing challenge
// discovery.

import { getServiceRoleClient } from "../_shared/database/client.ts";
import { browseChallenges } from "../_challenge/workflow.ts";
import { computeMatchmakingScore } from "./matchmaking-heuristics.ts";

const TRUST_BAND_WIDTH = 150;
const RECENTLY_ACTIVE_MINUTES = 15;

export async function recommendOpponentChallenges(userId: string, limit = 20) {
  const supabase = getServiceRoleClient();

  const { data: profile } = await supabase.from("profiles").select(
    "trust_score, kyc_status",
  ).eq("id", userId).single();
  if (!profile) return [];

  const candidates = await browseChallenges({
    sort: "newest",
    userId,
    limit: limit * 3,
  });

  const { data: candidateCreators } = await supabase
    .from("profiles")
    .select("id, trust_score")
    .in("id", candidates.map((c) => c.creator_id));
  const trustById = new Map(
    (candidateCreators ?? []).map((p) => [p.id, p.trust_score as number]),
  );

  // Business Rules §17: "never surfaces challenges above a user's
  // KYC-cleared stake ceiling" -- reads the same threshold
  // system_settings already defines rather than hard-coding a second copy.
  const { data: stakeCapSetting } = await supabase
    .from("system_settings")
    .select("value")
    .eq("key", "kyc_pre_verification_stake_cap_cents")
    .maybeSingle();
  const stakeCapCents = profile.kyc_status === "verified"
    ? Infinity
    : Number(stakeCapSetting?.value ?? 10000);

  return candidates
    .filter((c) => c.stake_cents <= stakeCapCents)
    .filter((c) => {
      const creatorTrust = trustById.get(c.creator_id) ?? 1000;
      return Math.abs(creatorTrust - (profile.trust_score as number)) <=
        TRUST_BAND_WIDTH;
    })
    .slice(0, limit);
}

export interface MatchmakingRecommendation {
  challengeId: string;
  creatorId: string;
  stakeCents: number;
  score: number;
}

/**
 * Phase 7 (AI-005): Matchmaking Intelligence. Reuses the SAME candidate
 * discovery as recommendOpponentChallenges above (browseChallenges) --
 * this platform's core loop is stake-based challenges, not a separate
 * matchmaking queue, so "recommend an opponent" and "recommend a
 * challenge to accept" are the same underlying query. What's different
 * here is RANKING by a composite score (trust/timezone/region/
 * availability/device-integrity/history) instead of just a hard trust-band
 * filter + newest-first -- a slightly-outside-band but otherwise great
 * match still surfaces, just lower, rather than being excluded outright.
 */
export async function recommendMatchmakingOpponents(
  userId: string,
  limit = 20,
): Promise<MatchmakingRecommendation[]> {
  const supabase = getServiceRoleClient();

  const { data: self } = await supabase
    .from("profiles")
    .select("trust_score, timezone_name, country_code")
    .eq("id", userId)
    .maybeSingle();
  if (!self) return [];

  const candidates = await browseChallenges({
    sort: "newest",
    userId,
    limit: limit * 3,
  });
  if (candidates.length === 0) return [];

  const creatorIds = [...new Set(candidates.map((c) => c.creator_id))];

  const [
    { data: creatorProfiles },
    { data: collusionFlags },
    { data: deviceFlags },
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, trust_score, timezone_name, country_code, last_seen_at")
      .in("id", creatorIds),
    supabase
      .from("fraud_flags")
      .select("primary_user_id, secondary_user_id")
      .eq("status", "open")
      .in("flag_type", ["collusion", "repeated_opponent"])
      .or(`primary_user_id.eq.${userId},secondary_user_id.eq.${userId}`),
    supabase
      .from("fraud_flags")
      .select("primary_user_id")
      .eq("status", "open")
      .in("flag_type", ["multi_account", "bot_activity"])
      .in("primary_user_id", creatorIds),
  ]);

  const creatorById = new Map((creatorProfiles ?? []).map((p) => [p.id, p]));
  const collusionPartners = new Set(
    (collusionFlags ?? []).map((f) =>
      f.primary_user_id === userId ? f.secondary_user_id : f.primary_user_id
    ),
  );
  const flaggedDevices = new Set(
    (deviceFlags ?? []).map((f) => f.primary_user_id),
  );

  const recentlyActiveCutoff = new Date(
    Date.now() - RECENTLY_ACTIVE_MINUTES * 60 * 1000,
  ).toISOString();

  const ranked = candidates.map((c) => {
    const creator = creatorById.get(c.creator_id);
    const score = computeMatchmakingScore({
      trustGap: Math.abs(
        (creator?.trust_score as number ?? 1000) -
          (self.trust_score as number),
      ),
      sameTimezone: Boolean(
        creator?.timezone_name && creator.timezone_name === self.timezone_name,
      ),
      sameRegion: Boolean(
        creator?.country_code && creator.country_code === self.country_code,
      ),
      candidateRecentlyActive: Boolean(
        creator?.last_seen_at &&
          (creator.last_seen_at as string) >= recentlyActiveCutoff,
      ),
      candidateDeviceFlagged: flaggedDevices.has(c.creator_id),
      hasCollusionHistory: collusionPartners.has(c.creator_id),
    });

    return {
      challengeId: c.id,
      creatorId: c.creator_id,
      stakeCents: c.stake_cents,
      score,
    };
  });

  return ranked
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/**
 * Phase 7 (AI-005) Recommendation Engine: friend suggestions. Standard
 * "friends of friends" (2-hop), reusing the existing friends/blocked_users
 * tables directly -- no new social graph mechanism. "Communities", "events"
 * (as an entity distinct from tournaments), and "content" are NOT
 * recommended: repository audit (Phase 7) confirmed none of those exist
 * anywhere in this schema, and inventing them would mean building new
 * product surfaces, not extending existing ones -- documented as a gap in
 * docs/RECOMMENDATION_ENGINE_DESIGN.md rather than fabricated.
 */
export async function recommendFriends(
  userId: string,
  limit = 20,
): Promise<{ userId: string; mutualFriendCount: number }[]> {
  const supabase = getServiceRoleClient();

  const { data: existingRelations } = await supabase
    .from("friends")
    .select("requester_id, addressee_id")
    .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`);

  const directFriendIds = new Set<string>();
  for (const r of existingRelations ?? []) {
    directFriendIds.add(
      r.requester_id === userId ? r.addressee_id : r.requester_id,
    );
  }
  if (directFriendIds.size === 0) return [];

  const { data: blocks } = await supabase
    .from("blocked_users")
    .select("blocker_id, blocked_id")
    .or(`blocker_id.eq.${userId},blocked_id.eq.${userId}`);
  const blockedIds = new Set(
    (blocks ?? []).flatMap((b) => [b.blocker_id, b.blocked_id]),
  );

  const { data: secondHop } = await supabase
    .from("friends")
    .select("requester_id, addressee_id")
    .eq("status", "accepted")
    .or(
      [...directFriendIds].map((id) =>
        `requester_id.eq.${id},addressee_id.eq.${id}`
      ).join(","),
    );

  const mutualCounts = new Map<string, number>();
  for (const r of secondHop ?? []) {
    for (const candidate of [r.requester_id, r.addressee_id]) {
      if (candidate === userId) continue;
      if (directFriendIds.has(candidate)) continue;
      if (blockedIds.has(candidate)) continue;
      mutualCounts.set(candidate, (mutualCounts.get(candidate) ?? 0) + 1);
    }
  }

  return [...mutualCounts.entries()]
    .map(([id, count]) => ({ userId: id, mutualFriendCount: count }))
    .sort((a, b) => b.mutualFriendCount - a.mutualFriendCount)
    .slice(0, limit);
}

/**
 * Phase 7 (AI-005) Recommendation Engine: open tournaments a player can
 * plausibly afford and is trust-eligible for, reusing the same KYC stake
 * ceiling as recommendOpponentChallenges rather than a second copy of that
 * rule.
 */
export async function recommendTournaments(
  userId: string,
  limit = 20,
) {
  const supabase = getServiceRoleClient();

  const { data: profile } = await supabase
    .from("profiles")
    .select("kyc_status")
    .eq("id", userId)
    .maybeSingle();
  if (!profile) return [];

  const { data: stakeCapSetting } = await supabase
    .from("system_settings")
    .select("value")
    .eq("key", "kyc_pre_verification_stake_cap_cents")
    .maybeSingle();
  const stakeCapCents = profile.kyc_status === "verified"
    ? Infinity
    : Number(stakeCapSetting?.value ?? 10000);

  const { data: alreadyRegistered } = await supabase
    .from("tournament_registrations")
    .select("tournament_id")
    .eq("user_id", userId);
  const registeredIds = new Set(
    (alreadyRegistered ?? []).map((r) => r.tournament_id),
  );

  const { data: openTournaments } = await supabase
    .from("tournaments")
    .select("id, name, entry_fee_cents, status")
    .eq("status", "registration")
    .order("created_at", { ascending: false })
    .limit(limit * 2);

  return (openTournaments ?? [])
    .filter((t) => !registeredIds.has(t.id))
    .filter((t) => t.entry_fee_cents <= stakeCapCents)
    .slice(0, limit);
}
