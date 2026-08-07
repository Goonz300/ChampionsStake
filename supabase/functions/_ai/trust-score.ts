// supabase/functions/_ai/trust-score.ts
//
// Mirrors REALTIME-001's notification-dispatch pattern in spirit (consumes
// EDGE-001's domain_events log rather than being called directly by
// CHALLENGE-001/MODERATOR-001), but NOT in one specific mechanical detail:
// REALTIME-001's dispatcher already claims domain_events.processed_at as
// ITS OWN "done" marker. If this trust-score consumer used that same
// column, whichever of the two dispatchers runs second on a given event
// would see it already marked processed and silently skip it -- a real bug
// caught while writing this file's first draft, not a hypothetical.
// Fixed by never touching processed_at at all: idempotency here is
// determined by checking whether a trust_score_history row already exists
// for the challenge/dispute in question, which is a correct and
// side-effect-free way for two independent consumers to share one event
// log without stepping on each other.

import { getServiceRoleClient } from "../_shared/database/client.ts";
import { logger } from "../_shared/logger/index.ts";
import { getWalletById } from "../_wallet/repository.ts";
import {
  clampTrustScore,
  computeDisputeLossAdjustment,
  computeEloUpdate,
} from "./elo.ts";

const supabase = getServiceRoleClient();

async function alreadyProcessed(
  challengeId: string,
  reason: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("trust_score_history")
    .select("id")
    .eq("challenge_id", challengeId)
    .eq("reason", reason)
    .limit(1)
    .maybeSingle();
  return Boolean(data);
}

/**
 * Phase 7: idempotency for reasons with no natural challenge_id (withdrawal
 * reliability, tournament no-shows, chargebacks, sanctions hits). Keyed on
 * the domain_events row id itself (migration 0086's source_event_id) rather
 * than a business entity, so it works for any event type without new FK
 * coupling.
 */
async function alreadyProcessedByEvent(eventId: string): Promise<boolean> {
  const { data } = await supabase
    .from("trust_score_history")
    .select("id")
    .eq("source_event_id", eventId)
    .limit(1)
    .maybeSingle();
  return Boolean(data);
}

async function applyRatingChange(
  userId: string,
  challengeId: string | null,
  newRating: number,
  oldRating: number,
  reason: string,
  kFactor: number,
  opponentRatingAtTime: number | null,
  sourceEventId: string | null = null,
): Promise<void> {
  await supabase.from("profiles").update({ trust_score: newRating }).eq(
    "id",
    userId,
  );
  await supabase.from("trust_score_history").insert({
    user_id: userId,
    challenge_id: challengeId,
    old_score: oldRating,
    new_score: newRating,
    delta: newRating - oldRating,
    reason,
    k_factor: kFactor,
    opponent_score_at_time: opponentRatingAtTime,
    source_event_id: sourceEventId,
  });
}

/**
 * Phase 7: fixed-magnitude adjustment for non-pairwise signals (no
 * "opponent" exists for a withdrawal settling or a sanctions hit, so the
 * Elo exchange in elo.ts doesn't apply -- k_factor is stored as 0 for these
 * rows to make that explicit in the audit trail, not omitted, per Business
 * Rules §13's reproducibility requirement).
 */
async function applyFixedDelta(
  userId: string,
  delta: number,
  reason: string,
  sourceEventId: string,
): Promise<void> {
  const oldRating = await getRating(userId);
  const newRating = clampTrustScore(oldRating + delta);
  await applyRatingChange(
    userId,
    null,
    newRating,
    oldRating,
    reason,
    0,
    null,
    sourceEventId,
  );
}

async function getRating(userId: string): Promise<number> {
  const { data } = await supabase.from("profiles").select("trust_score").eq(
    "id",
    userId,
  ).single();
  return (data?.trust_score as number) ?? 1000;
}

/** Standard match-completion adjustment (mutual release path). Idempotent:
 * checks trust_score_history before applying, so re-processing the same
 * ChallengeCompleted event twice (e.g. after a crash mid-batch) never
 * double-adjusts a rating. */
async function handleChallengeCompleted(challengeId: string): Promise<void> {
  if (await alreadyProcessed(challengeId, "match_win")) return;

  const { data: challenge } = await supabase
    .from("challenges")
    .select("creator_id, opponent_id, winner_submitted_by, release_reason")
    .eq("id", challengeId)
    .maybeSingle();

  if (!challenge || !challenge.winner_submitted_by || !challenge.opponent_id) {
    return;
  }
  if (challenge.release_reason === "refund_void") return; // voided matches have no trust impact (Business Rules §7)

  const winnerId = challenge.winner_submitted_by;
  const loserId = winnerId === challenge.creator_id
    ? challenge.opponent_id
    : challenge.creator_id;

  const winnerRating = await getRating(winnerId);
  const loserRating = await getRating(loserId);
  const update = computeEloUpdate(winnerRating, loserRating);

  await applyRatingChange(
    winnerId,
    challengeId,
    update.newWinnerRating,
    winnerRating,
    "match_win",
    32,
    loserRating,
  );
  await applyRatingChange(
    loserId,
    challengeId,
    update.newLoserRating,
    loserRating,
    "match_loss",
    32,
    winnerRating,
  );
}

/** Dispute-decided adjustment: the losing side of a moderator decision
 * takes an amplified penalty (Business Rules §13); the winning side gets
 * the standard win delta, no bonus. */
async function handleModeratorDecision(disputeId: string): Promise<void> {
  const { data: dispute } = await supabase.from("disputes").select(
    "challenge_id, resolution",
  ).eq("id", disputeId).maybeSingle();
  if (
    !dispute || dispute.resolution === "voided" ||
    dispute.resolution === "split"
  ) return;
  if (await alreadyProcessed(dispute.challenge_id, "dispute_loss")) return;

  const { data: challenge } = await supabase
    .from("challenges")
    .select("creator_id, opponent_id, winner_submitted_by")
    .eq("id", dispute.challenge_id)
    .maybeSingle();
  if (!challenge?.opponent_id) return;

  const winnerId = dispute.resolution === "winner_confirmed"
    ? challenge.winner_submitted_by!
    : challenge.winner_submitted_by === challenge.creator_id
    ? challenge.opponent_id
    : challenge.creator_id;
  const loserId = winnerId === challenge.creator_id
    ? challenge.opponent_id
    : challenge.creator_id;

  const winnerRating = await getRating(winnerId);
  const loserRating = await getRating(loserId);
  const update = computeEloUpdate(winnerRating, loserRating);
  const amplifiedLoserDelta = computeDisputeLossAdjustment(
    loserRating,
    update.loserDelta,
  );

  await applyRatingChange(
    winnerId,
    dispute.challenge_id,
    update.newWinnerRating,
    winnerRating,
    "dispute_win",
    32,
    loserRating,
  );
  await applyRatingChange(
    loserId,
    dispute.challenge_id,
    loserRating + amplifiedLoserDelta,
    loserRating,
    "dispute_loss",
    32,
    winnerRating,
  );
}

// Phase 7: fixed deltas for non-pairwise signals. Magnitudes are
// deliberately smaller than the Elo K-factor=32 match exchange for routine
// signals (withdrawal reliability) and larger for signals that indicate
// genuine platform harm (chargebacks, sanctions) -- same "explainable,
// deterministic" spirit as elo.ts, just not an Elo exchange since there's
// no opponent for these.
const WITHDRAWAL_SETTLED_DELTA = 3;
const WITHDRAWAL_REVERSED_DELTA = -10;
const TOURNAMENT_NO_SHOW_DELTA = -15;
const CHARGEBACK_DELTA = -80;
const SANCTIONS_BLOCK_DELTA = -100;

async function handleWithdrawalSettled(
  eventId: string,
  walletId: string,
): Promise<void> {
  if (await alreadyProcessedByEvent(eventId)) return;
  const wallet = await getWalletById(walletId);
  await applyFixedDelta(
    wallet.userId,
    WITHDRAWAL_SETTLED_DELTA,
    "withdrawal_settled",
    eventId,
  );
}

async function handleWithdrawalReversed(
  eventId: string,
  walletId: string,
): Promise<void> {
  if (await alreadyProcessedByEvent(eventId)) return;
  const wallet = await getWalletById(walletId);
  await applyFixedDelta(
    wallet.userId,
    WITHDRAWAL_REVERSED_DELTA,
    "withdrawal_reversed",
    eventId,
  );
}

async function handleTournamentNoShow(
  eventId: string,
  userId: string,
): Promise<void> {
  if (await alreadyProcessedByEvent(eventId)) return;
  await applyFixedDelta(
    userId,
    TOURNAMENT_NO_SHOW_DELTA,
    "tournament_no_show",
    eventId,
  );
}

async function handleChargebackRecorded(
  eventId: string,
  userId: string,
): Promise<void> {
  if (await alreadyProcessedByEvent(eventId)) return;
  await applyFixedDelta(userId, CHARGEBACK_DELTA, "chargeback", eventId);
}

async function handleSanctionsBlocked(
  eventId: string,
  userId: string,
): Promise<void> {
  if (await alreadyProcessedByEvent(eventId)) return;
  await applyFixedDelta(
    userId,
    SANCTIONS_BLOCK_DELTA,
    "sanctions_block",
    eventId,
  );
}

const SWEPT_EVENT_TYPES = [
  "ChallengeCompleted",
  "ModeratorDecisionRecorded",
  // Phase 7 additions:
  "WithdrawalSettled",
  "WithdrawalReversed",
  "TournamentNoShowRecorded",
  "ChargebackRecorded",
  "SanctionsScreeningBlocked",
] as const;

/**
 * Sweeps recent domain_events for every trust-relevant type (see
 * SWEPT_EVENT_TYPES). Does NOT mark domain_events.processed_at (see file
 * header) -- instead reads a recent time window and relies on each
 * handler's own idempotency check, so re-running this sweep is always safe.
 *
 * Phase 7 hostile-review-class fix: this query and the dispatch loop below
 * previously filtered/read a column named "type" -- domain_events' actual
 * column (migration 0034) is "event_type" (confirmed against the correct
 * usage in _realtime/notifications.ts's processUnhandledEvents, which reads
 * event.event_type throughout). PostgREST rejects a filter on a nonexistent
 * column, so every call to this function has been throwing since it was
 * written -- Trust Engine v1's sweep has never actually processed a single
 * match or dispute event. The scheduled ai-trust-score-every-10-minutes cron
 * job (migration 0061) has been calling a function that always errors.
 */
export async function processTrustScoreEvents(
  lookbackHours = 24,
  limit = 200,
): Promise<{ scanned: number; adjusted: number }> {
  const since = new Date(Date.now() - lookbackHours * 60 * 60 * 1000)
    .toISOString();

  const { data: events, error } = await supabase
    .from("domain_events")
    .select("*")
    .in("event_type", SWEPT_EVENT_TYPES)
    .gte("created_at", since)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) throw new Error(`Failed to fetch events: ${error.message}`);

  let adjusted = 0;
  for (const event of events ?? []) {
    try {
      if (
        event.event_type === "ChallengeCompleted" &&
        event.payload?.challengeId
      ) {
        const before = await alreadyProcessed(
          event.payload.challengeId,
          "match_win",
        );
        await handleChallengeCompleted(event.payload.challengeId);
        if (!before) adjusted += 1;
      } else if (
        event.event_type === "ModeratorDecisionRecorded" &&
        event.payload?.disputeId
      ) {
        const { data: dispute } = await supabase.from("disputes").select(
          "challenge_id",
        ).eq("id", event.payload.disputeId).maybeSingle();
        const before = dispute
          ? await alreadyProcessed(dispute.challenge_id, "dispute_loss")
          : true;
        await handleModeratorDecision(event.payload.disputeId);
        if (!before) adjusted += 1;
      } else if (
        event.event_type === "WithdrawalSettled" && event.payload?.walletId
      ) {
        const before = await alreadyProcessedByEvent(event.id);
        await handleWithdrawalSettled(event.id, event.payload.walletId);
        if (!before) adjusted += 1;
      } else if (
        event.event_type === "WithdrawalReversed" && event.payload?.walletId
      ) {
        const before = await alreadyProcessedByEvent(event.id);
        await handleWithdrawalReversed(event.id, event.payload.walletId);
        if (!before) adjusted += 1;
      } else if (
        event.event_type === "TournamentNoShowRecorded" &&
        event.payload?.userId
      ) {
        const before = await alreadyProcessedByEvent(event.id);
        await handleTournamentNoShow(event.id, event.payload.userId);
        if (!before) adjusted += 1;
      } else if (
        event.event_type === "ChargebackRecorded" && event.payload?.userId
      ) {
        const before = await alreadyProcessedByEvent(event.id);
        await handleChargebackRecorded(event.id, event.payload.userId);
        if (!before) adjusted += 1;
      } else if (
        event.event_type === "SanctionsScreeningBlocked" &&
        event.payload?.userId
      ) {
        const before = await alreadyProcessedByEvent(event.id);
        await handleSanctionsBlocked(event.id, event.payload.userId);
        if (!before) adjusted += 1;
      }
    } catch (err) {
      logger.error("Failed to process trust score event", {
        eventId: event.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { scanned: (events ?? []).length, adjusted };
}

export interface TrustProfile {
  userId: string;
  trustScore: number;
  accountAgeDays: number;
  kycVerified: boolean;
  deviceCount: number;
  openFraudFlagsCount: number;
}

/**
 * Phase 7: explainable read-only snapshot combining the event-driven
 * trust_score (see trust_score_history for the "why") with factors that are
 * continuous rather than discrete events -- account age and KYC status
 * change by simply existing/being set, not by a business event worth
 * logging a delta for every time they're read. Deliberately NOT baked into
 * profiles.trust_score itself: Risk Engine (P7-M2) and Matchmaking
 * Intelligence (P7-M4) combine these factors with the stored score rather
 * than trust-score.ts guessing how heavily each should be weighted for
 * every possible consumer.
 */
export async function getTrustProfile(userId: string): Promise<TrustProfile> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("trust_score, kyc_status, created_at")
    .eq("id", userId)
    .maybeSingle();

  if (!profile) {
    throw new Error(`No profile found for user ${userId}.`);
  }

  const accountAgeDays = Math.max(
    0,
    Math.floor(
      (Date.now() - new Date(profile.created_at as string).getTime()) /
        (24 * 60 * 60 * 1000),
    ),
  );

  const [{ count: deviceCount }, { count: openFraudFlagsCount }] = await Promise
    .all([
      supabase
        .from("devices")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId),
      supabase
        .from("fraud_flags")
        .select("id", { count: "exact", head: true })
        .eq("primary_user_id", userId)
        .eq("status", "open"),
    ]);

  return {
    userId,
    trustScore: profile.trust_score as number,
    accountAgeDays,
    kycVerified: profile.kyc_status === "verified",
    deviceCount: deviceCount ?? 0,
    openFraudFlagsCount: openFraudFlagsCount ?? 0,
  };
}
