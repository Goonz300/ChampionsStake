// supabase/functions/_ai/fraud-detection.ts
//
// Business Rules §14/§17: "scores above threshold auto-flag for moderator
// queue, never auto-block funds without human review in v1." Every
// function here only ever INSERTs into fraud_flags -- none of them touch
// wallets, escrow, or challenge status.

import { getServiceRoleClient } from "../_shared/database/client.ts";
import {
  getWalletById,
  getWalletByUserIdOrThrow,
  listTransactions,
} from "../_wallet/repository.ts";
import {
  computeDurationStats,
  findCircularPairs,
  isPrizeFarmingPattern,
} from "./fraud-heuristics.ts";

const supabase = getServiceRoleClient();

const REPEATED_OPPONENT_THRESHOLD = 5;
const REPEATED_OPPONENT_SCORE = 60;
const MULTI_ACCOUNT_SCORE = 85;

// Phase 7 (AI-003) thresholds. Same "named constant, not a magic number
// buried in a query" convention as the values above.
const CIRCULAR_PAYOUT_SCORE = 75;
const IMPOSSIBLE_TRAVEL_WINDOW_HOURS = 2;
const IMPOSSIBLE_TRAVEL_SCORE = 55;
const BONUS_ABUSE_WITHDRAWAL_WINDOW_HOURS = 1;
const BONUS_ABUSE_SCORE = 70;
const PRIZE_FARMING_MIN_MATCHES = 8;
const PRIZE_FARMING_MIN_WIN_RATE = 0.85;
const PRIZE_FARMING_TRUST_GAP = 300;
const PRIZE_FARMING_SCORE = 65;

export type FraudFlagType =
  | "collusion"
  | "multi_account"
  | "repeated_opponent"
  | "circular_payout"
  | "bonus_abuse"
  | "prize_farming"
  | "bot_activity";

async function raiseFlag(
  flagType: FraudFlagType,
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
  if (secondaryUserId) {
    existingQuery = existingQuery.eq("secondary_user_id", secondaryUserId);
  }

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
export async function checkRepeatedOpponent(
  challengeId: string,
): Promise<void> {
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

  const { data: creatorDevices } = await supabase.from("devices").select(
    "device_fingerprint",
  ).eq("user_id", challenge.creator_id);
  const { data: opponentDevices } = await supabase
    .from("devices")
    .select("device_fingerprint")
    .eq("user_id", challenge.opponent_id);

  const creatorSet = new Set(
    (creatorDevices ?? []).map((d) => d.device_fingerprint),
  );
  const sharedFingerprints = (opponentDevices ?? [])
    .map((d) => d.device_fingerprint)
    .filter((fp) => creatorSet.has(fp));

  if (sharedFingerprints.length === 0) return;

  await raiseFlag(
    "multi_account",
    challenge.creator_id,
    challenge.opponent_id,
    challengeId,
    MULTI_ACCOUNT_SCORE,
    {
      shared_fingerprint_count: sharedFingerprints.length,
    },
  );
}

export async function scanChallenge(challengeId: string): Promise<void> {
  await checkRepeatedOpponent(challengeId);
  await checkMultiAccount(challengeId);
}

// Phase 7 (AI-003) additions below. Match-fixing / tournament-manipulation
// is deliberately NOT a separate function here: generateBracket (Phase 8)
// turns every real tournament match into an actual challenges row (see its
// own doc comment), so checkRepeatedOpponent/checkMultiAccount ALREADY run
// against tournament matches transparently via scanChallenge -- adding a
// tournament-scoped duplicate would be exactly the "never duplicate logic
// already present" violation this phase's brief warns against.

/**
 * Circular payout: A pays B, B pays A back, within the same sweep window.
 * Reuses audit_logs' existing "WalletToWalletTransfer" action (recorded by
 * _wallet/transfer.ts's walletToWallet) rather than adding new bookkeeping
 * -- the wallet engine already logs every transfer's wallet_ids in
 * metadata.
 */
export async function checkCircularPayouts(
  hours = 24,
  limit = 500,
): Promise<{ scanned: number; flagged: number }> {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const { data: transfers } = await supabase
    .from("audit_logs")
    .select("id, metadata, created_at")
    .eq("action", "WalletToWalletTransfer")
    .gte("created_at", since)
    .order("created_at", { ascending: true })
    .limit(limit);

  const edgeCounts: Record<string, number> = {};
  for (const t of transfers ?? []) {
    const walletIds = (t.metadata as Record<string, unknown> | null)
      ?.wallet_ids as string[] | undefined;
    if (!walletIds || walletIds.length !== 2) continue;
    const key = `${walletIds[0]}->${walletIds[1]}`;
    edgeCounts[key] = (edgeCounts[key] ?? 0) + 1;
  }

  const pairs = findCircularPairs(edgeCounts);
  for (const pair of pairs) {
    const [fromWallet, toWallet] = await Promise.all([
      getWalletById(pair.from),
      getWalletById(pair.to),
    ]);
    await raiseFlag(
      "circular_payout",
      fromWallet.userId,
      toWallet.userId,
      null,
      CIRCULAR_PAYOUT_SCORE,
      {
        walletA: pair.from,
        walletB: pair.to,
        transfersAtoB: pair.forwardCount,
        transfersBtoA: pair.backwardCount,
      },
    );
  }

  return { scanned: (transfers ?? []).length, flagged: pairs.length };
}

/**
 * Impossible travel: two consecutive logins for the same user report
 * different countries less than IMPOSSIBLE_TRAVEL_WINDOW_HOURS apart.
 * Reuses device_ip_history.country_code (migration 0080, sourced from the
 * CF-IPCountry header) -- no GeoIP lookup, so this only catches a COUNTRY
 * change, not fine-grained impossible-distance detection within a country.
 * An honest limitation of the free data source available, not a bug.
 */
export async function checkImpossibleTravel(
  userId: string,
): Promise<void> {
  const { data: deviceRows } = await supabase
    .from("devices")
    .select("id")
    .eq("user_id", userId);
  const deviceIds = (deviceRows ?? []).map((d) => d.id as string);
  if (deviceIds.length === 0) return;

  const { data: history } = await supabase
    .from("device_ip_history")
    .select("country_code, seen_at")
    .in("device_id", deviceIds)
    .not("country_code", "is", null)
    .order("seen_at", { ascending: false })
    .limit(5);

  const rows = history ?? [];
  for (let i = 0; i < rows.length - 1; i++) {
    const newer = rows[i];
    const older = rows[i + 1];
    if (newer.country_code === older.country_code) continue;

    const hoursApart = (new Date(newer.seen_at as string).getTime() -
      new Date(older.seen_at as string).getTime()) / (60 * 60 * 1000);
    if (hoursApart < IMPOSSIBLE_TRAVEL_WINDOW_HOURS) {
      await raiseFlag(
        "multi_account", // reuses the existing type: an account genuinely shared/hijacked across locations is the same underlying suspicion multi_account already models -- see fraud_flags.details for the distinguishing signal
        userId,
        null,
        null,
        IMPOSSIBLE_TRAVEL_SCORE,
        {
          signal: "impossible_travel",
          fromCountry: older.country_code,
          toCountry: newer.country_code,
          hoursApart: Math.round(hoursApart * 100) / 100,
        },
      );
      return;
    }
  }
}

/**
 * Bonus abuse: promotional credit reaching `bonus` sub-balance and being
 * withdrawn within BONUS_ABUSE_WITHDRAWAL_WINDOW_HOURS, with no genuine
 * play activity (challenge/tournament participation) in between --
 * indicates farming the bonus itself rather than using it to play.
 */
export async function checkBonusAbuse(userId: string): Promise<void> {
  const wallet = await getWalletByUserIdOrThrow(userId);

  const bonusCredits = await listTransactions({
    walletId: wallet.walletId,
    type: "bonus_credit",
    limit: 5,
  });
  if (bonusCredits.length === 0) return;

  const withdrawals = await listTransactions({
    walletId: wallet.walletId,
    type: "withdrawal",
    limit: 5,
  });
  if (withdrawals.length === 0) return;

  for (const credit of bonusCredits) {
    const creditedAt = new Date(credit.created_at as string).getTime();
    const followingWithdrawal = withdrawals.find((w) => {
      const withdrawnAt = new Date(w.created_at as string).getTime();
      const hoursAfter = (withdrawnAt - creditedAt) / (60 * 60 * 1000);
      return hoursAfter >= 0 &&
        hoursAfter <= BONUS_ABUSE_WITHDRAWAL_WINDOW_HOURS;
    });
    if (!followingWithdrawal) continue;

    const { count: playCount } = await supabase
      .from("challenges")
      .select("id", { count: "exact", head: true })
      .or(`creator_id.eq.${userId},opponent_id.eq.${userId}`)
      .eq("status", "completed")
      .gte("created_at", credit.created_at as string)
      .lte("created_at", followingWithdrawal.created_at as string);

    if ((playCount ?? 0) > 0) continue; // genuine play activity in between -- not abuse

    await raiseFlag(
      "bonus_abuse",
      userId,
      null,
      null,
      BONUS_ABUSE_SCORE,
      {
        bonusTransactionId: credit.id,
        withdrawalTransactionId: followingWithdrawal.id,
        windowHours: BONUS_ABUSE_WITHDRAWAL_WINDOW_HOURS,
      },
    );
    return;
  }
}

/**
 * Prize farming: an implausibly high win rate against opponents whose
 * trust score is far lower -- winning legitimately-matched games is not
 * suspicious; consistently beating much-lower-trust (likely newer/weaker)
 * opponents at a near-perfect rate over enough matches to rule out
 * variance is the signal.
 */
export async function checkPrizeFarming(userId: string): Promise<void> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data: matches } = await supabase
    .from("challenges")
    .select("creator_id, opponent_id, winner_submitted_by")
    .or(`creator_id.eq.${userId},opponent_id.eq.${userId}`)
    .eq("status", "completed")
    .not("winner_submitted_by", "is", null)
    .gte("created_at", since)
    .limit(200);

  const rows = matches ?? [];
  if (rows.length < PRIZE_FARMING_MIN_MATCHES) return;

  const wins = rows.filter((m) => m.winner_submitted_by === userId).length;
  const winRate = wins / rows.length;
  if (winRate < PRIZE_FARMING_MIN_WIN_RATE) return;

  const userTrust = await getRatingForFraudCheck(userId);
  const opponentIds = rows.map((m) =>
    m.creator_id === userId ? m.opponent_id : m.creator_id
  ).filter((id): id is string => Boolean(id));
  if (opponentIds.length === 0) return;

  const { data: opponents } = await supabase
    .from("profiles")
    .select("trust_score")
    .in("id", opponentIds);
  const avgOpponentTrust = (opponents ?? []).reduce(
    (sum, o) => sum + (o.trust_score as number),
    0,
  ) / Math.max(1, (opponents ?? []).length);

  const trustGap = userTrust - avgOpponentTrust;
  if (
    !isPrizeFarmingPattern(
      rows.length,
      winRate,
      trustGap,
      PRIZE_FARMING_MIN_MATCHES,
      PRIZE_FARMING_MIN_WIN_RATE,
      PRIZE_FARMING_TRUST_GAP,
    )
  ) return;

  await raiseFlag(
    "prize_farming",
    userId,
    null,
    null,
    PRIZE_FARMING_SCORE,
    {
      matchCount: rows.length,
      winRate: Math.round(winRate * 1000) / 1000,
      userTrustScore: userTrust,
      avgOpponentTrustScore: Math.round(avgOpponentTrust),
    },
  );
}

async function getRatingForFraudCheck(userId: string): Promise<number> {
  const { data } = await supabase.from("profiles").select("trust_score").eq(
    "id",
    userId,
  ).maybeSingle();
  return (data?.trust_score as number) ?? 1000;
}

/**
 * Bot activity heuristic: a device fingerprint that has completed an
 * implausible number of matches with near-zero variance in
 * time-to-completion is more consistent with scripted automation than
 * human play. Explicitly a heuristic (not a trained classifier) --
 * documented as such rather than overclaiming ML-grade bot detection this
 * environment has no training pipeline to actually build.
 */
const BOT_ACTIVITY_MIN_MATCHES = 10;
const BOT_ACTIVITY_MAX_STDDEV_SECONDS = 5;
const BOT_ACTIVITY_SCORE = 50;

export async function checkBotActivity(userId: string): Promise<void> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: matches } = await supabase
    .from("challenges")
    .select("created_at, completed_at")
    .or(`creator_id.eq.${userId},opponent_id.eq.${userId}`)
    .eq("status", "completed")
    .not("completed_at", "is", null)
    .gte("created_at", since)
    .limit(50);

  const durations = (matches ?? [])
    .map((m) => {
      const start = new Date(m.created_at as string).getTime();
      const end = new Date(m.completed_at as string).getTime();
      return (end - start) / 1000;
    })
    .filter((d) => d > 0);

  if (durations.length < BOT_ACTIVITY_MIN_MATCHES) return;

  const { mean, stddev } = computeDurationStats(durations);

  if (stddev > BOT_ACTIVITY_MAX_STDDEV_SECONDS) return;

  await raiseFlag(
    "bot_activity",
    userId,
    null,
    null,
    BOT_ACTIVITY_SCORE,
    {
      matchCount: durations.length,
      meanDurationSeconds: Math.round(mean),
      stddevSeconds: Math.round(stddev * 100) / 100,
    },
  );
}

/**
 * Orchestrates the Phase 7 fraud sweeps that aren't per-challenge (those
 * still run via sweepRecentChallenges/scanChallenge above). Scans users
 * with recent activity rather than every user, same bounded-window
 * philosophy as sweepRecentChallenges.
 */
export async function sweepFraudIntelligence(
  hours = 24,
  userLimit = 200,
): Promise<{ circularPayouts: number; usersScanned: number }> {
  const circular = await checkCircularPayouts(hours);

  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const { data: activeUsers } = await supabase
    .from("challenges")
    .select("creator_id, opponent_id")
    .gte("created_at", since)
    .limit(userLimit);

  const userIds = new Set<string>();
  for (const row of activeUsers ?? []) {
    userIds.add(row.creator_id as string);
    if (row.opponent_id) userIds.add(row.opponent_id as string);
  }

  for (const userId of userIds) {
    await checkImpossibleTravel(userId);
    await checkBonusAbuse(userId);
    await checkPrizeFarming(userId);
    await checkBotActivity(userId);
  }

  return { circularPayouts: circular.flagged, usersScanned: userIds.size };
}

export async function sweepRecentChallenges(
  hours = 24,
  limit = 200,
): Promise<{ scanned: number }> {
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
    .update({
      status: outcome,
      reviewed_by: reviewerId,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", flagId);
}

// Phase 8.5 performance review fix: had no .limit() at all when status was
// omitted -- fraud_flags accumulates monotonically as the fraud-detection
// sweeps run on a schedule, so this was a genuinely unbounded full-table
// fetch, growing worse over the platform's lifetime every time a moderator
// opened the flag dashboard without filtering by status.
export async function listFraudFlags(status?: string, limit = 200) {
  let query = supabase.from("fraud_flags").select(
    "*, primary:primary_user_id(display_name)",
  ).order("score", { ascending: false }).limit(limit);
  if (status) query = query.eq("status", status);
  const { data, error } = await query;
  if (error) throw new Error(`Failed to list fraud flags: ${error.message}`);
  return data ?? [];
}
