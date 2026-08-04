// supabase/functions/_challenge/escrow-transition.ts
//
// This is the "escrow-transition" Edge Function logic named throughout
// Architecture §5 and the Roadmap — implemented as a shared module (not a
// single monolithic Edge Function) so each challenge action gets its own
// thin, individually-rate-limited HTTP entry point (challenge-publish,
// challenge-accept, etc.), all calling into this one place for the actual
// state-transition + escrow orchestration logic. This keeps exactly one
// implementation of "what happens when a challenge moves from X to Y",
// which is the point of having an escrow-transition engine at all.
//
// SCOPE BOUNDARY: this file owns the Challenge <-> Escrow state machine.
// It does NOT implement chat, disputes, tournaments, or notifications —
// those are separate Roadmap milestones (5.2, 5.3, 9, 7 respectively).
// Where this engine would need one of those (e.g. "notify the opponent"),
// it emits a domain event and stops — a future NotificationEngine reads
// that event, it isn't inlined here.

import { getServiceRoleClient } from "../_shared/database/client.ts";
import { ChallengeError, ConflictError, AuthorizationError } from "../_shared/errors/index.ts";
import { recordAudit } from "../_shared/audit/index.ts";
import { emit } from "../_shared/events/index.ts";
import { lockToEscrow, releaseFromEscrow } from "../_wallet/transfer.ts";
import {
  getChallengeOrThrow,
  getWalletIdForUser,
  getOrCreateEscrowAccount,
  updateChallengeStatus,
  recordChallengeEvent,
  upsertParticipant,
  isParticipant,
} from "./repository.ts";
import type { Challenge } from "./types.ts";

const READY_CHECK_WINDOW_MINUTES = 10;
const OPPONENT_STAKE_CAPTURE_TIMEOUT_MINUTES = 10;

function assertStatus(challenge: Challenge, expected: Challenge["status"][], action: string): void {
  if (!expected.includes(challenge.status)) {
    throw new ConflictError(
      `Cannot ${action} challenge ${challenge.id}: current status is "${challenge.status}", expected one of [${expected.join(", ")}].`,
    );
  }
}

/**
 * Publish: locks the creator's stake, moves draft -> published.
 * Business Rules §3: "no challenge exists in a public/visible state without
 * the creator's stake already locked."
 */
export async function publishChallenge(challengeId: string, callerId: string): Promise<void> {
  const challenge = await getChallengeOrThrow(challengeId);
  assertStatus(challenge, ["draft"], "publish");

  if (challenge.creatorId !== callerId) {
    throw new AuthorizationError("Only the creator may publish this challenge.");
  }

  const walletId = await getWalletIdForUser(callerId);
  await getOrCreateEscrowAccount(challengeId);

  await lockToEscrow(walletId, challenge.stakeCents, { table: "challenges", id: challengeId }, callerId, `publish-${challengeId}`);
  await upsertParticipant(challengeId, callerId, "creator", challenge.stakeCents);

  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
  await updateChallengeStatus(challengeId, { status: "published" });
  await recordChallengeEvent(challengeId, "ChallengeCreated", callerId, { expires_at: expiresAt });

  await recordAudit({
    actorId: callerId,
    actorType: "user",
    action: "ChallengeCreated",
    category: "challenge",
    targetTable: "challenges",
    targetId: challengeId,
    metadata: { stake_cents: challenge.stakeCents },
  });

  await emit({ type: "ChallengeCreated", payload: { challengeId, creatorId: callerId }, emittedBy: "challenge-publish" });
  await emit({ type: "EscrowLocked", payload: { challengeId, side: "creator" }, emittedBy: "challenge-publish" });
}

/**
 * Accept: locks the opponent's stake, moving published -> accepted ->
 * escrow_pending -> escrow_locked. The escrow_pending state (CHALLENGE-001)
 * is the async window between committing to lock funds and that lock
 * actually confirming — if lockToEscrow throws, the challenge is reverted
 * to 'cancelled' with the opponent never having been charged, rather than
 * being left stuck in an ambiguous state.
 */
export async function acceptChallenge(challengeId: string, callerId: string): Promise<void> {
  const challenge = await getChallengeOrThrow(challengeId);
  assertStatus(challenge, ["published", "waiting"], "accept");

  if (challenge.creatorId === callerId) {
    throw new ChallengeError("You cannot accept your own challenge.");
  }

  const supabase = getServiceRoleClient();
  await supabase.from("challenges").update({ opponent_id: callerId }).eq("id", challengeId);
  await updateChallengeStatus(challengeId, { status: "accepted", acceptedAt: new Date().toISOString() });
  await updateChallengeStatus(challengeId, { status: "escrow_pending" });

  const walletId = await getWalletIdForUser(callerId);

  try {
    await lockToEscrow(walletId, challenge.stakeCents, { table: "challenges", id: challengeId }, callerId, `accept-${challengeId}`);
  } catch (err) {
    await updateChallengeStatus(challengeId, { status: "cancelled", cancelledAt: new Date().toISOString() });
    await recordChallengeEvent(challengeId, "ChallengeCancelled", callerId, {
      reason: "Escrow lock failed during accept",
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }

  await upsertParticipant(challengeId, callerId, "opponent", challenge.stakeCents);
  await updateChallengeStatus(challengeId, { status: "escrow_locked" });

  await recordChallengeEvent(challengeId, "ChallengeAccepted", callerId);
  await recordChallengeEvent(challengeId, "EscrowLocked", callerId, { side: "opponent" });
  await recordChallengeEvent(challengeId, "ChatOpened", null, { challenge_id: challengeId });

  await recordAudit({
    actorId: callerId,
    actorType: "user",
    action: "ChallengeAccepted",
    category: "challenge",
    targetTable: "challenges",
    targetId: challengeId,
  });

  await emit({ type: "ChallengeAccepted", payload: { challengeId, opponentId: callerId }, emittedBy: "challenge-accept" });
  await emit({ type: "EscrowLocked", payload: { challengeId, side: "opponent" }, emittedBy: "challenge-accept" });
  // Chat opening is TRIGGERED here (an event), never implemented here —
  // per this phase's explicit "do not implement chat, only trigger its
  // opening" instruction. A future Chat Engine (Roadmap Milestone 5.2)
  // subscribes to this event / reads the ChatOpened challenge_event.
  await emit({ type: "NotificationQueued", payload: { reason: "chat_opened", challengeId }, emittedBy: "challenge-accept" });
}

/**
 * Ready check: escrow_locked -> ready (first confirmer) -> countdown (once
 * both sides confirm). Actually starting the match (countdown -> live) is a
 * separate step (startMatch, below) — CHALLENGE-001 models these as
 * distinct states so a scheduler can own the countdown-elapses-then-go-live
 * transition server-side, rather than trusting a client's "my countdown
 * hit zero" claim (this phase's explicit "never trust client state" rule).
 */
export async function readyCheck(challengeId: string, callerId: string): Promise<{ bothReady: boolean }> {
  const challenge = await getChallengeOrThrow(challengeId);
  assertStatus(challenge, ["escrow_locked", "ready"], "ready-check");

  if (!(await isParticipant(challengeId, callerId))) {
    throw new AuthorizationError("Only challenge participants may ready-check.");
  }

  const supabase = getServiceRoleClient();
  const readyDeadline = new Date(Date.now() + READY_CHECK_WINDOW_MINUTES * 60 * 1000).toISOString();

  await supabase
    .from("challenge_participants")
    .update({ ready_at: new Date().toISOString() })
    .eq("challenge_id", challengeId)
    .eq("user_id", callerId);

  if (challenge.status === "escrow_locked") {
    await updateChallengeStatus(challengeId, { status: "ready", readyDeadlineAt: readyDeadline });
    await recordChallengeEvent(challengeId, "ReadyStarted", callerId);
    await emit({ type: "ChallengeAccepted", payload: { challengeId, event: "ReadyStarted" }, emittedBy: "challenge-ready" });
  }

  const { data: participants } = await supabase
    .from("challenge_participants")
    .select("ready_at")
    .eq("challenge_id", challengeId);

  const bothReady = (participants ?? []).every((p) => p.ready_at !== null) && (participants ?? []).length === 2;

  if (bothReady) {
    await updateChallengeStatus(challengeId, { status: "countdown" });
    await recordChallengeEvent(challengeId, "CountdownStarted", null);
    await emit({ type: "ChallengeAccepted", payload: { challengeId, event: "CountdownStarted" }, emittedBy: "challenge-ready" });
  }

  return { bothReady };
}

const COUNTDOWN_SECONDS = 10;

/**
 * Starts the match: countdown -> live. Server-authoritative — this is
 * called either by a scheduler (challenge-start Edge Function, triggered
 * COUNTDOWN_SECONDS after CountdownStarted was recorded) or, for a faster
 * UX, by either participant's client polling — but the transition itself
 * only succeeds if the countdown window has actually elapsed server-side,
 * never based on a client's local timer.
 */
export async function startMatch(challengeId: string): Promise<void> {
  const challenge = await getChallengeOrThrow(challengeId);
  assertStatus(challenge, ["countdown"], "start");

  const supabase = getServiceRoleClient();
  const { data: countdownEvent } = await supabase
    .from("challenge_events")
    .select("created_at")
    .eq("challenge_id", challengeId)
    .eq("event_type", "CountdownStarted")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const countdownStartedAt = countdownEvent ? new Date(countdownEvent.created_at).getTime() : 0;
  const elapsedSeconds = (Date.now() - countdownStartedAt) / 1000;

  if (elapsedSeconds < COUNTDOWN_SECONDS) {
    throw new ConflictError(
      `Countdown has not yet elapsed for challenge ${challengeId} (${elapsedSeconds.toFixed(1)}s of ${COUNTDOWN_SECONDS}s).`,
    );
  }

  await updateChallengeStatus(challengeId, { status: "live", liveStartedAt: new Date().toISOString() });
  await recordChallengeEvent(challengeId, "MatchStarted", null);

  await recordAudit({
    actorId: null,
    actorType: "system",
    action: "MatchStarted",
    category: "challenge",
    targetTable: "challenges",
    targetId: challengeId,
  });

  await emit({ type: "ChallengeAccepted", payload: { challengeId, event: "MatchStarted" }, emittedBy: "challenge-start" });
}

/**
 * Declare winner: live -> winner_submitted. Uses `result_locked` as a
 * concurrency guard — the UPDATE is conditioned on `result_locked = false`
 * so two concurrent declare-winner calls can't both succeed (this phase's
 * "double win claim" protection, Business Rules §3/§7).
 */
export async function declareWinner(challengeId: string, callerId: string): Promise<void> {
  const challenge = await getChallengeOrThrow(challengeId);
  assertStatus(challenge, ["live"], "declare a winner for");

  if (!(await isParticipant(challengeId, callerId))) {
    throw new AuthorizationError("Only challenge participants may declare a winner.");
  }

  const supabase = getServiceRoleClient();

  // Conditional UPDATE: only succeeds if result_locked is still false.
  // Postgres evaluates the WHERE clause atomically per row, so this is the
  // actual concurrency guard — not just an application-level check that a
  // second concurrent request could race past.
  const { data: updated, error } = await supabase
    .from("challenges")
    .update({
      status: "winner_submitted",
      result_locked: true,
      winner_submitted_by: callerId,
      winner_submitted_at: new Date().toISOString(),
    })
    .eq("id", challengeId)
    .eq("result_locked", false)
    .select("id")
    .maybeSingle();

  if (error) throw new Error(`Failed to declare winner: ${error.message}`);
  if (!updated) {
    throw new ConflictError(
      "A result has already been submitted for this challenge — respond to your opponent's claim instead.",
    );
  }

  await recordChallengeEvent(challengeId, "WinnerSubmitted", callerId);
  await recordAudit({
    actorId: callerId,
    actorType: "user",
    action: "WinnerSubmitted",
    category: "challenge",
    targetTable: "challenges",
    targetId: challengeId,
  });
  await emit({ type: "ChallengeAccepted", payload: { challengeId, event: "WinnerSubmitted" }, emittedBy: "challenge-declare-winner" });
}

/**
 * Release: winner_submitted -> released -> completed. Only the
 * NON-claiming participant may call this (Business Rules §7 — a claiming
 * party can never self-release their own claim).
 */
/**
 * Shared fund-distribution primitive: moves the winner's own stake back to
 * them (no fee) and the loser's stake to the winner minus the platform fee.
 * Used by BOTH the participant-triggered releaseFunds (below) and
 * MODERATOR-001's moderator decision path (_moderator/decisions.ts calls
 * moderatorResolveDispute, which calls this same helper) -- extracted here
 * specifically so a future phase never has to duplicate this fee/release
 * math, keeping "the Escrow Engine performs all financial operations" true
 * in one literal place rather than two copies that could drift apart.
 */
async function distributeChallengeFunds(
  challengeId: string,
  winnerId: string,
  loserId: string,
  stakeCents: number,
  releaseReason: "mutual_release" | "moderator_decision",
  actorId: string,
): Promise<{ feeCents: number }> {
  const winnerWalletId = await getWalletIdForUser(winnerId);
  const loserWalletId = await getWalletIdForUser(loserId);

  const totalPotCents = stakeCents * 2;
  const platformFeePercent = 7.5; // Business Rules §6 default; system_settings.platform_fee_percent is the source of truth for a future override
  const feeCents = Math.round((totalPotCents * platformFeePercent) / 100);

  await releaseFromEscrow(
    winnerWalletId,
    winnerWalletId,
    stakeCents,
    0,
    releaseReason,
    { table: "challenges", id: challengeId },
    actorId,
    `release-own-stake-${challengeId}`,
  );
  await releaseFromEscrow(
    loserWalletId,
    winnerWalletId,
    stakeCents,
    feeCents,
    releaseReason,
    { table: "challenges", id: challengeId },
    actorId,
    `release-loser-stake-${challengeId}`,
  );

  return { feeCents };
}

export async function releaseFunds(challengeId: string, callerId: string): Promise<void> {
  const challenge = await getChallengeOrThrow(challengeId);
  assertStatus(challenge, ["winner_submitted", "awaiting_confirmation"], "release funds for");

  if (!(await isParticipant(challengeId, callerId))) {
    throw new AuthorizationError("Only challenge participants may release funds.");
  }
  if (challenge.winnerSubmittedBy === callerId) {
    throw new AuthorizationError("The party who submitted the winning claim cannot release their own funds.");
  }

  const winnerId = challenge.winnerSubmittedBy!;
  const loserId = callerId;

  const { feeCents } = await distributeChallengeFunds(challengeId, winnerId, loserId, challenge.stakeCents, "mutual_release", loserId);

  // The DB-001 state-machine guard trigger only allows 'released' to be
  // reached FROM 'awaiting_confirmation', not directly from
  // 'winner_submitted' — so this always passes through that intermediate
  // state first, even though Business Rules describes it as effectively an
  // alias of the same real-world moment.
  if (challenge.status === "winner_submitted") {
    await updateChallengeStatus(challengeId, { status: "awaiting_confirmation" });
  }
  await updateChallengeStatus(challengeId, { status: "released", releaseReason: "mutual_release" });

  await recordChallengeEvent(challengeId, "FundsReleased", callerId, { winner_id: winnerId, fee_cents: feeCents });
  await recordAudit({
    actorId: callerId,
    actorType: "user",
    action: "FundsReleased",
    category: "financial",
    targetTable: "challenges",
    targetId: challengeId,
    metadata: { winner_id: winnerId, fee_cents: feeCents },
  });

  await emit({ type: "FundsReleased", payload: { challengeId, winnerId, feeCents }, emittedBy: "challenge-release" });

  // Finalization (released -> completed) is a deliberately separate step
  // (completeChallenge, below) — CHALLENGE-001 asks for challenge-complete
  // as its own Edge Function/state, distinct from the release action
  // itself, so completion-time bookkeeping (archival eligibility, trust
  // score hooks for a future phase) has one place to live regardless of
  // whether completion follows a mutual release or a moderator decision.
  await completeChallenge(challengeId);
}

/**
 * Finalizes a challenge: released -> completed, OR moderator_review ->
 * completed (the dispute-resolution path — Roadmap Milestone 5.3 will call
 * this the same way once it exists; this function has no opinion about
 * which path led here). Emits ChallengeCompleted and marks the challenge
 * archive-eligible for the archival scheduler.
 */
export async function completeChallenge(challengeId: string): Promise<void> {
  const challenge = await getChallengeOrThrow(challengeId);
  assertStatus(challenge, ["released", "moderator_review"], "complete");

  await updateChallengeStatus(challengeId, { status: "completed", completedAt: new Date().toISOString() });
  await recordChallengeEvent(challengeId, "ChallengeCompleted", null);

  await recordAudit({
    actorId: null,
    actorType: "system",
    action: "ChallengeCompleted",
    category: "challenge",
    targetTable: "challenges",
    targetId: challengeId,
  });

  await emit({ type: "ChallengeCompleted", payload: { challengeId }, emittedBy: "challenge-complete" });
}

/**
 * Cancel: allowed pre-accept unilaterally, or (per Business Rules §7) with
 * mutual approval post-accept — this function implements only the
 * pre-accept unilateral path plus the refund; the mutual-approval
 * negotiation UI/flow for a post-accept cancel is a frontend/notification
 * concern layered on top, not implemented here.
 */
/**
 * Moderator dispute resolution: moderator_review -> completed, releasing
 * funds to whichever party the moderator's decision names as winner.
 * Reuses the exact same distributeChallengeFunds helper releaseFunds
 * uses — this is the concrete mechanism behind "the Escrow Engine performs
 * all financial operations, moderators never touch financial tables
 * directly" (MODERATOR-001): this function IS the Escrow Engine's own
 * code, called by the moderator layer, not duplicated inside it.
 */
export async function moderatorResolveDispute(
  challengeId: string,
  winnerId: string,
  moderatorId: string,
): Promise<{ feeCents: number }> {
  const challenge = await getChallengeOrThrow(challengeId);
  assertStatus(challenge, ["moderator_review"], "resolve via moderator decision for");

  const loserId = winnerId === challenge.creatorId ? challenge.opponentId! : challenge.creatorId;

  const { feeCents } = await distributeChallengeFunds(
    challengeId,
    winnerId,
    loserId,
    challenge.stakeCents,
    "moderator_decision",
    moderatorId,
  );

  await recordChallengeEvent(challengeId, "FundsReleased", moderatorId, {
    winner_id: winnerId,
    fee_cents: feeCents,
    via: "moderator_decision",
  });
  await recordAudit({
    actorId: moderatorId,
    actorType: "moderator",
    action: "FundsReleased",
    category: "financial",
    targetTable: "challenges",
    targetId: challengeId,
    metadata: { winner_id: winnerId, fee_cents: feeCents, via: "moderator_decision" },
  });
  await emit({
    type: "FundsReleased",
    payload: { challengeId, winnerId, feeCents, via: "moderator_decision" },
    emittedBy: "moderator-decision",
  });

  await completeChallenge(challengeId);
  return { feeCents };
}

/**
 * Moderator void: moderator_review -> cancelled, refunding BOTH parties in
 * full with no fee and no trust-score impact (Business Rules §7). Reuses
 * releaseFromEscrow directly (self-refund pattern, same as
 * cancelChallenge/expireChallenge elsewhere in this file) rather than
 * distributeChallengeFunds, since a void has no winner to pay.
 */
export async function moderatorVoidMatch(challengeId: string, moderatorId: string): Promise<void> {
  const challenge = await getChallengeOrThrow(challengeId);
  assertStatus(challenge, ["moderator_review"], "void via moderator decision for");

  for (const userId of [challenge.creatorId, challenge.opponentId!]) {
    const walletId = await getWalletIdForUser(userId);
    await releaseFromEscrow(
      walletId,
      walletId,
      challenge.stakeCents,
      0,
      "moderator_decision",
      { table: "challenges", id: challengeId },
      moderatorId,
      `moderator-void-${challengeId}-${userId}`,
    );
  }

  await updateChallengeStatus(challengeId, {
    status: "cancelled",
    cancelledAt: new Date().toISOString(),
    releaseReason: "moderator_decision",
  });
  await recordChallengeEvent(challengeId, "ChallengeCancelled", moderatorId, { reason: "Voided by moderator decision" });
  await recordAudit({
    actorId: moderatorId,
    actorType: "moderator",
    action: "MatchVoided",
    category: "financial",
    targetTable: "challenges",
    targetId: challengeId,
  });
  await emit({ type: "FundsReleased", payload: { challengeId, event: "MatchVoided" }, emittedBy: "moderator-decision" });
}

export async function cancelChallenge(challengeId: string, callerId: string, reason: string): Promise<void> {
  const challenge = await getChallengeOrThrow(challengeId);
  assertStatus(challenge, ["draft", "published", "waiting"], "cancel");

  if (challenge.creatorId !== callerId) {
    throw new AuthorizationError("Only the creator may cancel a challenge before it's accepted.");
  }

  if (challenge.status !== "draft") {
    // A stake was locked at publish — refund it.
    const walletId = await getWalletIdForUser(callerId);
    await releaseFromEscrow(
      walletId,
      walletId,
      challenge.stakeCents,
      0,
      "refund_void",
      { table: "challenges", id: challengeId },
      callerId,
      `cancel-refund-${challengeId}`,
    );
  }

  await updateChallengeStatus(challengeId, { status: "cancelled", cancelledAt: new Date().toISOString() });
  await recordChallengeEvent(challengeId, "ChallengeCancelled", callerId, { reason });

  await recordAudit({
    actorId: callerId,
    actorType: "user",
    action: "ChallengeCancelled",
    category: "challenge",
    targetTable: "challenges",
    targetId: challengeId,
    metadata: { reason },
  });
}
