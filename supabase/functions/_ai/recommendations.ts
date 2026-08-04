// supabase/functions/_ai/recommendations.ts
//
// Reuses CHALLENGE-001's browseChallenges directly for the actual query
// (game/platform/region/stake filters, RLS-safe visibility) -- this file
// only adds the trust-score-band post-filter and KYC-ceiling check
// Business Rules §17 asks for, rather than re-implementing challenge
// discovery.

import { getServiceRoleClient } from "../_shared/database/client.ts";
import { browseChallenges } from "../_challenge/workflow.ts";

const TRUST_BAND_WIDTH = 150;

export async function recommendOpponentChallenges(userId: string, limit = 20) {
  const supabase = getServiceRoleClient();

  const { data: profile } = await supabase.from("profiles").select("trust_score, kyc_status").eq("id", userId).single();
  if (!profile) return [];

  const candidates = await browseChallenges({ sort: "newest", userId, limit: limit * 3 });

  const { data: candidateCreators } = await supabase
    .from("profiles")
    .select("id, trust_score")
    .in("id", candidates.map((c) => c.creator_id));
  const trustById = new Map((candidateCreators ?? []).map((p) => [p.id, p.trust_score as number]));

  // Business Rules §17: "never surfaces challenges above a user's
  // KYC-cleared stake ceiling" -- reads the same threshold
  // system_settings already defines rather than hard-coding a second copy.
  const { data: stakeCapSetting } = await supabase
    .from("system_settings")
    .select("value")
    .eq("key", "kyc_pre_verification_stake_cap_cents")
    .maybeSingle();
  const stakeCapCents = profile.kyc_status === "verified" ? Infinity : Number(stakeCapSetting?.value ?? 10000);

  return candidates
    .filter((c) => c.stake_cents <= stakeCapCents)
    .filter((c) => {
      const creatorTrust = trustById.get(c.creator_id) ?? 1000;
      return Math.abs(creatorTrust - (profile.trust_score as number)) <= TRUST_BAND_WIDTH;
    })
    .slice(0, limit);
}
