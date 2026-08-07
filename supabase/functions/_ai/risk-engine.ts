// supabase/functions/_ai/risk-engine.ts
//
// Phase 7 (AI-003): unified, explainable risk scoring (migration 0087's
// risk_scores table). Never auto-blocks anything -- same Business Rules
// §14/§17 posture as fraud_flags: scores are for moderator/admin review and
// for other engines (AI Moderation Assistant, Matchmaking Intelligence) to
// weigh, not a trigger that itself freezes a wallet or rejects a
// withdrawal. Each computeXRiskScore function is a plain, inspectable sum
// of named factors (same "deterministic, reproducible" bar as elo.ts),
// not a black-box model.

import { getServiceRoleClient } from "../_shared/database/client.ts";
import { getTrustProfile } from "./trust-score.ts";

const supabase = getServiceRoleClient();

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, value));
}

async function upsertRiskScore(
  subjectType:
    | "player"
    | "wallet"
    | "challenge"
    | "tournament"
    | "payment"
    | "withdrawal"
    | "organizer"
    | "moderator"
    | "device"
    | "ip",
  subjectId: string,
  score: number,
  factors: Record<string, unknown>,
): Promise<void> {
  await supabase.from("risk_scores").upsert(
    {
      subject_type: subjectType,
      subject_id: subjectId,
      score: clampScore(score),
      factors,
      computed_at: new Date().toISOString(),
    },
    { onConflict: "subject_type,subject_id" },
  );
}

export interface PlayerRiskResult {
  score: number;
  factors: Record<string, unknown>;
}

/**
 * Player risk: inverse of trust (a low trust score is itself a risk
 * signal, but risk also weighs things trust deliberately doesn't --
 * account age and open investigation count matter for "should this
 * withdrawal get extra scrutiny right now", not for "was this player a
 * good opponent historically").
 */
export async function computePlayerRiskScore(
  userId: string,
): Promise<PlayerRiskResult> {
  const trust = await getTrustProfile(userId);

  const trustDeficit = clampScore((1000 - trust.trustScore) / 10);
  const fraudFlagPenalty = Math.min(40, trust.openFraudFlagsCount * 15);
  const newAccountPenalty = trust.accountAgeDays < 7 ? 15 : 0;
  const unverifiedPenalty = trust.kycVerified ? 0 : 10;

  const factors = {
    trustScore: trust.trustScore,
    trustDeficit,
    openFraudFlagsCount: trust.openFraudFlagsCount,
    fraudFlagPenalty,
    accountAgeDays: trust.accountAgeDays,
    newAccountPenalty,
    kycVerified: trust.kycVerified,
    unverifiedPenalty,
  };

  const score = clampScore(
    trustDeficit + fraudFlagPenalty + newAccountPenalty + unverifiedPenalty,
  );
  await upsertRiskScore("player", userId, score, factors);
  return { score, factors };
}

/**
 * Withdrawal risk: reuses the SAME limits Phase 6's withdrawal-service.ts
 * already enforces (config.withdrawal.*) as explainable factors, rather
 * than inventing a second set of thresholds -- this score explains WHY a
 * withdrawal is risky using numbers an admin reviewing the same withdrawal
 * in admin-wallets already recognizes.
 */
export async function computeWithdrawalRiskScore(
  intentId: string,
): Promise<PlayerRiskResult> {
  const { data: intent } = await supabase
    .from("payment_intents")
    .select("user_id, amount_cents")
    .eq("id", intentId)
    .eq("kind", "withdrawal")
    .maybeSingle();

  if (!intent) {
    throw new Error(`No withdrawal payment_intent found for ${intentId}.`);
  }

  const [{ score: playerScore }, { count: chargebackCount }] = await Promise
    .all([
      computePlayerRiskScore(intent.user_id),
      supabase
        .from("chargebacks")
        .select("id", { count: "exact", head: true })
        .eq("user_id", intent.user_id),
    ]);

  const chargebackPenalty = Math.min(40, (chargebackCount ?? 0) * 40);
  const playerRiskContribution = playerScore * 0.5;

  const factors = {
    playerRiskScore: playerScore,
    playerRiskContribution,
    chargebackCount: chargebackCount ?? 0,
    chargebackPenalty,
    amountCents: intent.amount_cents,
  };

  const score = clampScore(playerRiskContribution + chargebackPenalty);
  await upsertRiskScore("withdrawal", intentId, score, factors);
  return { score, factors };
}

export interface IpRiskResult {
  score: number;
  factors: Record<string, unknown>;
}

/**
 * IP risk: purely a function of fn_classify_ip's output (via
 * device_ip_history's cached classification) -- TOR is weighted higher
 * than datacenter since a real player's residential ISP is never TOR, but
 * legitimate VPS-hosted automation (e.g. a streaming/casting service) can
 * legitimately originate from a datacenter IP.
 */
export async function computeIpRiskScore(ip: string): Promise<IpRiskResult> {
  const { data: rows } = await supabase
    .from("device_ip_history")
    .select("is_tor, is_datacenter")
    .eq("ip_address", ip)
    .order("seen_at", { ascending: false })
    .limit(1);

  const row = rows?.[0];
  const isTor = Boolean(row?.is_tor);
  const isDatacenter = Boolean(row?.is_datacenter);

  const factors = { ip, isTor, isDatacenter };
  const score = clampScore((isTor ? 70 : 0) + (isDatacenter ? 30 : 0));
  await upsertRiskScore("ip", ip, score, factors);
  return { score, factors };
}
