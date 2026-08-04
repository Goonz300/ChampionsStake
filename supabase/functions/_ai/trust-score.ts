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
import { computeEloUpdate, computeDisputeLossAdjustment } from "./elo.ts";

const supabase = getServiceRoleClient();

async function alreadyProcessed(challengeId: string, reason: string): Promise<boolean> {
  const { data } = await supabase
    .from("trust_score_history")
    .select("id")
    .eq("challenge_id", challengeId)
    .eq("reason", reason)
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
  opponentRatingAtTime: number,
): Promise<void> {
  await supabase.from("profiles").update({ trust_score: newRating }).eq("id", userId);
  await supabase.from("trust_score_history").insert({
    user_id: userId,
    challenge_id: challengeId,
    old_score: oldRating,
    new_score: newRating,
    delta: newRating - oldRating,
    reason,
    k_factor: kFactor,
    opponent_score_at_time: opponentRatingAtTime,
  });
}

async function getRating(userId: string): Promise<number> {
  const { data } = await supabase.from("profiles").select("trust_score").eq("id", userId).single();
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

  if (!challenge || !challenge.winner_submitted_by || !challenge.opponent_id) return;
  if (challenge.release_reason === "refund_void") return; // voided matches have no trust impact (Business Rules §7)

  const winnerId = challenge.winner_submitted_by;
  const loserId = winnerId === challenge.creator_id ? challenge.opponent_id : challenge.creator_id;

  const winnerRating = await getRating(winnerId);
  const loserRating = await getRating(loserId);
  const update = computeEloUpdate(winnerRating, loserRating);

  await applyRatingChange(winnerId, challengeId, update.newWinnerRating, winnerRating, "match_win", 32, loserRating);
  await applyRatingChange(loserId, challengeId, update.newLoserRating, loserRating, "match_loss", 32, winnerRating);
}

/** Dispute-decided adjustment: the losing side of a moderator decision
 * takes an amplified penalty (Business Rules §13); the winning side gets
 * the standard win delta, no bonus. */
async function handleModeratorDecision(disputeId: string): Promise<void> {
  const { data: dispute } = await supabase.from("disputes").select("challenge_id, resolution").eq("id", disputeId).maybeSingle();
  if (!dispute || dispute.resolution === "voided" || dispute.resolution === "split") return;
  if (await alreadyProcessed(dispute.challenge_id, "dispute_loss")) return;

  const { data: challenge } = await supabase
    .from("challenges")
    .select("creator_id, opponent_id, winner_submitted_by")
    .eq("id", dispute.challenge_id)
    .maybeSingle();
  if (!challenge?.opponent_id) return;

  const winnerId =
    dispute.resolution === "winner_confirmed"
      ? challenge.winner_submitted_by!
      : challenge.winner_submitted_by === challenge.creator_id
        ? challenge.opponent_id
        : challenge.creator_id;
  const loserId = winnerId === challenge.creator_id ? challenge.opponent_id : challenge.creator_id;

  const winnerRating = await getRating(winnerId);
  const loserRating = await getRating(loserId);
  const update = computeEloUpdate(winnerRating, loserRating);
  const amplifiedLoserDelta = computeDisputeLossAdjustment(loserRating, update.loserDelta);

  await applyRatingChange(winnerId, dispute.challenge_id, update.newWinnerRating, winnerRating, "dispute_win", 32, loserRating);
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

/**
 * Sweeps recent ChallengeCompleted/ModeratorDecisionRecorded domain_events.
 * Does NOT mark domain_events.processed_at (see file header) -- instead
 * reads a recent time window and relies on handleChallengeCompleted/
 * handleModeratorDecision's own alreadyProcessed() check for idempotency,
 * so re-running this sweep is always safe.
 */
export async function processTrustScoreEvents(lookbackHours = 24, limit = 200): Promise<{ scanned: number; adjusted: number }> {
  const since = new Date(Date.now() - lookbackHours * 60 * 60 * 1000).toISOString();

  const { data: events, error } = await supabase
    .from("domain_events")
    .select("*")
    .in("type", ["ChallengeCompleted", "ModeratorDecisionRecorded"])
    .gte("created_at", since)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) throw new Error(`Failed to fetch events: ${error.message}`);

  let adjusted = 0;
  for (const event of events ?? []) {
    try {
      if (event.type === "ChallengeCompleted" && event.payload?.challengeId) {
        const before = await alreadyProcessed(event.payload.challengeId, "match_win");
        await handleChallengeCompleted(event.payload.challengeId);
        if (!before) adjusted += 1;
      } else if (event.type === "ModeratorDecisionRecorded" && event.payload?.disputeId) {
        const { data: dispute } = await supabase.from("disputes").select("challenge_id").eq("id", event.payload.disputeId).maybeSingle();
        const before = dispute ? await alreadyProcessed(dispute.challenge_id, "dispute_loss") : true;
        await handleModeratorDecision(event.payload.disputeId);
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
