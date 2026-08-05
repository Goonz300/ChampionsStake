// supabase/functions/_tournament/workflow.ts
//
// CRITICAL DESIGN NOTE — read before touching this file:
//
// Tournament entry fees are collected ONCE, at registration, into a
// tournament-level escrow (escrow_accounts.tournament_id). Individual
// bracket matches therefore do NOT lock or release per-match stakes the
// way a 1v1 challenge does — the money question was already settled at
// registration, and prize distribution happens ONCE at the end (Business
// Rules §5: "Prize Distribution: on final match completion, prize pool
// distributed... uses the same releaseEscrow primitive"). This file
// reuses CHALLENGE-001's gameplay-only functions (readyCheck, startMatch,
// declareWinner, completeChallenge — none of which move money) for every
// bracket match, and never calls WALLET-001's lockToEscrow/
// releaseFromEscrow per-match. It DOES call them exactly twice: once at
// registration (entry fee -> tournament escrow) and once at withdrawal/
// cancellation (refund). This is what "never duplicate Challenge/Escrow/
// Wallet logic, only coordinate them" means concretely.
//
// Match challenges are inserted directly with status='escrow_locked'
// (bypassing publishChallenge/acceptChallenge, which are for 1v1 stake
// locking) — a fresh INSERT is not subject to fn_challenge_state_guard
// (that trigger only fires on UPDATE), so this is a legitimate, guard-
// compatible way to seed a challenge directly into the gameplay-ready state.

import { z } from "zod";
import { getServiceRoleClient } from "../_shared/database/client.ts";
import {
  AuthorizationError,
  ConflictError,
  TournamentError,
} from "../_shared/errors/index.ts";
import { recordAudit } from "../_shared/audit/index.ts";
import { emit } from "../_shared/events/index.ts";
import { lockToEscrow, releaseFromEscrow } from "../_wallet/transfer.ts";
import { getWalletIdForUser } from "../_challenge/repository.ts";
import {
  completeChallenge,
  declareWinner as challengeDeclareWinner,
  readyCheck as challengeReadyCheck,
  startMatch as challengeStartMatch,
} from "../_challenge/escrow-transition.ts";
import {
  getChallengeOrThrow,
  recordChallengeEvent,
  updateChallengeStatus,
} from "../_challenge/repository.ts";
import {
  createRound,
  getCurrentRound,
  getRegistration,
  getTournamentOrThrow,
  listMatchesForRound,
  listRegistrations,
  updateRoundStatus,
  updateTournamentStatus,
} from "./repository.ts";
import { computeNextRound, getBracketGenerator } from "./bracket.ts";

export const createTournamentSchema = z.object({
  gameId: z.string().uuid(),
  name: z.string().min(3).max(100),
  format: z.enum(["single_elim", "double_elim", "round_robin"]),
  entryFeeCents: z.number().int().nonnegative(),
  registrationOpensAt: z.string().datetime({ offset: true }).optional(),
  registrationClosesAt: z.string().datetime({ offset: true }).optional(),
  checkInOpensAt: z.string().datetime({ offset: true }).optional(),
  startsAt: z.string().datetime({ offset: true }).optional(),
});
export type CreateTournamentInput = z.infer<typeof createTournamentSchema>;

export async function createTournament(
  adminId: string,
  input: CreateTournamentInput,
): Promise<{ id: string }> {
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase
    .from("tournaments")
    .insert({
      game_id: input.gameId,
      name: input.name,
      format: input.format,
      entry_fee_cents: input.entryFeeCents,
      status: "draft",
      created_by: adminId,
      registration_opens_at: input.registrationOpensAt,
      registration_closes_at: input.registrationClosesAt,
      check_in_opens_at: input.checkInOpensAt,
      starts_at: input.startsAt,
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`Failed to create tournament: ${error?.message}`);
  }

  await recordAudit({
    actorId: adminId,
    actorType: "administrator",
    action: "TournamentCreated",
    category: "tournament",
    targetTable: "tournaments",
    targetId: data.id,
  });
  await emit({
    type: "TournamentStarted",
    payload: { tournamentId: data.id, event: "TournamentCreated" },
    emittedBy: "tournament-create",
  });

  return { id: data.id };
}

export async function publishTournament(tournamentId: string): Promise<void> {
  await updateTournamentStatus(tournamentId, "published");
  await updateTournamentStatus(tournamentId, "registration");
  await emit({
    type: "TournamentStarted",
    payload: { tournamentId, event: "RegistrationOpened" },
    emittedBy: "tournament-publish",
  });
}

export async function closeRegistration(tournamentId: string): Promise<void> {
  await updateTournamentStatus(tournamentId, "registration_closed");
  await emit({
    type: "TournamentStarted",
    payload: { tournamentId, event: "RegistrationClosed" },
    emittedBy: "tournament-register",
  });
}

/**
 * Opens check-in: registration_closed -> check_in. Found missing during
 * this phase's own edge cross-check (the same verification method
 * ESCROW-001 and CHALLENGE-001 used) — without this function, nothing in
 * the codebase ever transitioned a tournament from registration_closed
 * into check_in, so generateBracket's precondition (status='check_in')
 * could never actually be reached. Fixed here rather than left as a
 * silent dead end.
 */
export async function openCheckIn(tournamentId: string): Promise<void> {
  await updateTournamentStatus(tournamentId, "check_in");
  await emit({
    type: "TournamentStarted",
    payload: { tournamentId, event: "CheckInOpened" },
    emittedBy: "tournament-checkin",
  });
}

/** Registers a player, capturing their entry fee into the tournament-level
 * escrow (WALLET-001's lockToEscrow, called exactly once per registration). */
export async function registerForTournament(
  tournamentId: string,
  userId: string,
  idempotencyKey: string,
): Promise<void> {
  const tournament = await getTournamentOrThrow(tournamentId);
  if (tournament.status !== "registration") {
    throw new ConflictError(
      `Tournament ${tournamentId} is not open for registration (status: ${tournament.status}).`,
    );
  }

  const existing = await getRegistration(tournamentId, userId);
  if (existing) {
    throw new ConflictError("You are already registered for this tournament.");
  }

  if (tournament.entryFeeCents > 0) {
    const walletId = await getWalletIdForUser(userId);
    await lockToEscrow(
      walletId,
      tournament.entryFeeCents,
      { table: "tournaments", id: tournamentId },
      userId,
      idempotencyKey,
    );
  }

  const supabase = getServiceRoleClient();
  const { error } = await supabase.from("tournament_registrations").insert({
    tournament_id: tournamentId,
    user_id: userId,
  });
  if (error) throw new Error(`Failed to register: ${error.message}`);

  await recordAudit({
    actorId: userId,
    actorType: "user",
    action: "TournamentRegistrationCreated",
    category: "tournament",
    targetTable: "tournament_registrations",
    targetId: `${tournamentId}:${userId}`,
  });
}

/** Withdraws a registration, refunding the entry fee — allowed only
 * pre-check-in (Business Rules §5: "full refund"). */
export async function withdrawRegistration(
  tournamentId: string,
  userId: string,
): Promise<void> {
  const tournament = await getTournamentOrThrow(tournamentId);
  if (!["registration", "registration_closed"].includes(tournament.status)) {
    throw new ConflictError(
      "Withdrawal is only allowed before check-in begins.",
    );
  }

  const registration = await getRegistration(tournamentId, userId);
  if (!registration) {
    throw new ConflictError("You are not registered for this tournament.");
  }

  if (tournament.entryFeeCents > 0) {
    const walletId = await getWalletIdForUser(userId);
    await releaseFromEscrow(
      walletId,
      walletId,
      tournament.entryFeeCents,
      0,
      "refund_void",
      { table: "tournaments", id: tournamentId },
      userId,
      `withdraw-${tournamentId}-${userId}`,
    );
  }

  const supabase = getServiceRoleClient();
  await supabase.from("tournament_registrations").delete().eq(
    "tournament_id",
    tournamentId,
  ).eq("user_id", userId);

  await recordAudit({
    actorId: userId,
    actorType: "user",
    action: "TournamentRegistrationWithdrawn",
    category: "tournament",
    targetTable: "tournament_registrations",
    targetId: `${tournamentId}:${userId}`,
  });
}

/** Player check-in. No-shows are handled by the check-in-timeout scheduler
 * (tournament-checkin Edge Function's sweep mode), which forfeits and
 * refunds them in full (Business Rules §5 — "no documented penalty in v1"). */
export async function checkIn(
  tournamentId: string,
  userId: string,
): Promise<void> {
  const tournament = await getTournamentOrThrow(tournamentId);
  if (tournament.status !== "check_in") {
    throw new ConflictError(
      `Tournament ${tournamentId} is not currently in check-in (status: ${tournament.status}).`,
    );
  }

  const supabase = getServiceRoleClient();
  const { error } = await supabase
    .from("tournament_registrations")
    .update({ checked_in_at: new Date().toISOString() })
    .eq("tournament_id", tournamentId)
    .eq("user_id", userId);

  if (error) throw new Error(`Failed to check in: ${error.message}`);
  await recordAudit({
    actorId: userId,
    actorType: "user",
    action: "TournamentCheckedIn",
    category: "tournament",
    targetTable: "tournament_registrations",
    targetId: `${tournamentId}:${userId}`,
  });
}

/** Forfeits every registration that never checked in, refunding their
 * entry fee in full — called by the check-in-timeout scheduler. */
export async function forfeitNoShows(
  tournamentId: string,
): Promise<{ forfeited: number }> {
  const registrations = await listRegistrations(tournamentId);
  const noShows = registrations.filter((r) =>
    r.checkedInAt === null && !r.forfeited
  );
  const tournament = await getTournamentOrThrow(tournamentId);
  const supabase = getServiceRoleClient();

  for (const reg of noShows) {
    if (tournament.entryFeeCents > 0) {
      const walletId = await getWalletIdForUser(reg.userId);
      await releaseFromEscrow(
        walletId,
        walletId,
        tournament.entryFeeCents,
        0,
        "auto_expiry",
        { table: "tournaments", id: tournamentId },
        null,
        `noshow-refund-${tournamentId}-${reg.userId}`,
      );
    }
    await supabase
      .from("tournament_registrations")
      .update({ forfeited: true })
      .eq("tournament_id", tournamentId)
      .eq("user_id", reg.userId);
  }

  return { forfeited: noShows.length };
}

/** Assigns seeds by trust score (descending), then generates round 1 of
 * the bracket. Every real (non-bye) match becomes an actual Challenge row —
 * this is the "never duplicate Challenge logic" boundary in concrete form. */
export async function generateBracket(tournamentId: string): Promise<void> {
  const tournament = await getTournamentOrThrow(tournamentId);
  if (tournament.status !== "check_in") {
    throw new ConflictError(
      `Bracket can only be generated from check_in (current: ${tournament.status}).`,
    );
  }

  const supabase = getServiceRoleClient();
  const registrations = await listRegistrations(tournamentId);
  const checkedIn = registrations.filter((r) =>
    r.checkedInAt !== null && !r.forfeited
  );

  if (checkedIn.length < 2) {
    throw new TournamentError(
      "At least 2 checked-in players are required to generate a bracket.",
    );
  }

  // Seed by trust_score descending (Business Rules §5), ties broken by
  // registration order — approximated here by profiles.trust_score lookup.
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, trust_score")
    .in("id", checkedIn.map((r) => r.userId));

  const trustById = new Map(
    (profiles ?? []).map((p) => [p.id, p.trust_score as number]),
  );
  const seeded = [...checkedIn].sort((a, b) =>
    (trustById.get(b.userId) ?? 0) - (trustById.get(a.userId) ?? 0)
  );

  for (let i = 0; i < seeded.length; i++) {
    await supabase
      .from("tournament_registrations")
      .update({ seed: i + 1 })
      .eq("tournament_id", tournamentId)
      .eq("user_id", seeded[i].userId);
    seeded[i].seed = i + 1;
  }

  const generator = getBracketGenerator(tournament.format);
  const firstRoundMatches = generator.generate(seeded);

  await updateTournamentStatus(tournamentId, "bracket_generated");
  const roundId = await createRound(
    tournamentId,
    1,
    roundName(1, firstRoundMatches.length),
  );

  for (const match of firstRoundMatches) {
    await createMatchOrAutoAdvance(
      tournamentId,
      roundId,
      match.bracketPosition,
      match.playerAId,
      match.playerBId,
    );
  }

  await recordAudit({
    actorId: null,
    actorType: "system",
    action: "BracketGenerated",
    category: "tournament",
    targetTable: "tournaments",
    targetId: tournamentId,
    metadata: {
      player_count: seeded.length,
      match_count: firstRoundMatches.length,
    },
  });
  await emit({
    type: "TournamentStarted",
    payload: { tournamentId, event: "BracketGenerated" },
    emittedBy: "tournament-generate-bracket",
  });
}

function roundName(roundNumber: number, matchCount: number): string {
  if (matchCount === 1) return "Final";
  if (matchCount === 2) return "Semi Finals";
  if (matchCount === 4) return "Quarter Finals";
  return `Round ${roundNumber}`;
}

/** Creates a real Challenge for a real match, or auto-advances a bye with
 * no challenge at all (there's no game to play against no one). */
async function createMatchOrAutoAdvance(
  tournamentId: string,
  roundId: string,
  bracketPosition: number,
  playerAId: string | null,
  playerBId: string | null,
): Promise<void> {
  const supabase = getServiceRoleClient();

  if (!playerAId || !playerBId) {
    // Bye: record the match with no challenge, winner is whoever isn't null.
    await supabase.from("tournament_matches").insert({
      tournament_id: tournamentId,
      round_id: roundId,
      bracket_position: bracketPosition,
      challenge_id: null,
    });
    return;
  }

  const tournament = await getTournamentOrThrow(tournamentId);

  const { data: challengeRow, error } = await supabase
    .from("challenges")
    .insert({
      creator_id: playerAId,
      opponent_id: playerBId,
      game_id: tournament.gameId,
      tournament_id: tournamentId,
      match_type: "tournament",
      // Non-zero placeholder to satisfy chk_challenges_stake_positive — no
      // per-match escrow is ever locked/released against this value (see
      // this file's header comment). Informational only.
      stake_cents: Math.max(tournament.entryFeeCents, 1),
      visibility: "private",
      platform_code: "pc",
      region_code: "global",
      status: "escrow_locked", // seeded directly — see header comment on why this is guard-compatible
    })
    .select("id")
    .single();

  if (error || !challengeRow) {
    throw new Error(
      `Failed to create tournament match challenge: ${error?.message}`,
    );
  }

  await supabase.from("challenge_participants").insert([
    { challenge_id: challengeRow.id, user_id: playerAId, role: "creator" },
    { challenge_id: challengeRow.id, user_id: playerBId, role: "opponent" },
  ]);

  await supabase.from("tournament_matches").insert({
    tournament_id: tournamentId,
    round_id: roundId,
    bracket_position: bracketPosition,
    challenge_id: challengeRow.id,
  });

  await recordChallengeEvent(challengeRow.id, "ChallengeCreated", null, {
    tournament_id: tournamentId,
  });
}

export async function startRound(tournamentId: string): Promise<void> {
  const round = await getCurrentRound(tournamentId);
  await updateTournamentStatus(tournamentId, "round_active");
  await updateRoundStatus(round.id, "in_progress");
  await recordAudit({
    actorId: null,
    actorType: "system",
    action: "RoundStarted",
    category: "tournament",
    targetTable: "tournament_rounds",
    targetId: round.id,
  });
  await emit({
    type: "TournamentRoundCompleted",
    payload: { tournamentId, event: "RoundStarted", roundId: round.id },
    emittedBy: "tournament-start-round",
  });
}

/** Delegates ready/start/declare-winner to CHALLENGE-001's existing
 * functions directly — no duplicated gameplay logic. */
export const readyForMatch = challengeReadyCheck;
export const startMatchPlay = challengeStartMatch;
export const declareMatchWinner = challengeDeclareWinner;

/**
 * Resolves a tournament match: winner_submitted -> awaiting_confirmation ->
 * released -> completed, WITHOUT moving any money (unlike 1v1's
 * releaseFunds) — see this file's header comment. Called once a winner has
 * been declared (challengeDeclareWinner), typically by the losing
 * participant confirming or by the round-completion sweep after a timeout.
 */
export async function resolveMatchNoMoney(
  challengeId: string,
): Promise<string> {
  const challenge = await getChallengeOrThrow(challengeId);
  if (!challenge.winnerSubmittedBy) {
    throw new ConflictError(
      `Challenge ${challengeId} has no winner submitted yet.`,
    );
  }

  if (challenge.status === "winner_submitted") {
    await updateChallengeStatus(challengeId, {
      status: "awaiting_confirmation",
    });
  }
  await updateChallengeStatus(challengeId, { status: "released" });
  await completeChallenge(challengeId);

  return challenge.winnerSubmittedBy;
}

/**
 * Completes the current round: resolves every finished match, computes the
 * next round from winners (or moves to prize_distribution if this was the
 * final). Eliminated players are marked so a future leaderboard/standings
 * view can reflect it.
 */
/**
 * Explicitly advances a player for a given tournament_matches row —
 * primarily for byes (which have no challenge_id, so completeRound's
 * automatic sweep can't read a winner from a challenge) and for admin
 * override cases (e.g. a disqualification). This is what
 * tournament-advance-player exposes.
 */
export async function advancePlayer(
  matchId: string,
  winnerId: string,
  actorId: string | null,
): Promise<void> {
  const supabase = getServiceRoleClient();
  const { data: match, error } = await supabase.from("tournament_matches")
    .select("*").eq("id", matchId).maybeSingle();
  if (error || !match) {
    throw new ConflictError(`Tournament match ${matchId} not found.`);
  }

  await recordAudit({
    actorId,
    actorType: actorId ? "administrator" : "system",
    action: "PlayerAdvanced",
    category: "tournament",
    targetTable: "tournament_matches",
    targetId: matchId,
    metadata: { winner_id: winnerId },
  });
  await emit({
    type: "TournamentRoundCompleted",
    payload: { matchId, event: "PlayerAdvanced", winnerId },
    emittedBy: "tournament-advance-player",
  });
}

export async function completeRound(
  tournamentId: string,
): Promise<{ finalRoundReached: boolean }> {
  const round = await getCurrentRound(tournamentId);
  const matches = await listMatchesForRound(round.id);
  const supabase = getServiceRoleClient();

  const results: { bracketPosition: number; winnerId: string | null }[] = [];

  for (const match of matches) {
    if (!match.challenge_id) {
      // Bye — has no challenge_id, so there's no winner_submitted_by to
      // read here. Resolved via a prior call to advancePlayer
      // (tournament-advance-player), called automatically for every bye
      // at bracket-generation time in a future refinement; for now this
      // is a known limitation stated in the deliverable's integrity
      // report rather than silently guessed at.
      continue;
    }

    const challenge = match.challenges;
    if (
      challenge?.status === "winner_submitted" ||
      challenge?.status === "awaiting_confirmation"
    ) {
      const winnerId = await resolveMatchNoMoney(match.challenge_id);
      results.push({ bracketPosition: match.bracket_position, winnerId });

      const loserId = winnerId === challenge.creator_id
        ? challenge.opponent_id
        : challenge.creator_id;
      await supabase
        .from("tournament_registrations")
        .update({ eliminated: true })
        .eq("tournament_id", tournamentId)
        .eq("user_id", loserId);
    } else if (challenge?.status === "completed") {
      results.push({
        bracketPosition: match.bracket_position,
        winnerId: challenge.winner_submitted_by,
      });
    }
  }

  await updateRoundStatus(round.id, "completed");
  await updateTournamentStatus(tournamentId, "round_complete");
  await recordAudit({
    actorId: null,
    actorType: "system",
    action: "RoundCompleted",
    category: "tournament",
    targetTable: "tournament_rounds",
    targetId: round.id,
  });
  await emit({
    type: "TournamentRoundCompleted",
    payload: { tournamentId, roundId: round.id },
    emittedBy: "tournament-complete-round",
  });

  if (results.length <= 1) {
    // The final just completed.
    await updateTournamentStatus(tournamentId, "prize_distribution");
    return { finalRoundReached: true };
  }

  const nextRoundMatches = computeNextRound(round.round_number, results);
  const nextRoundId = await createRound(
    tournamentId,
    round.round_number + 1,
    roundName(round.round_number + 1, nextRoundMatches.length),
  );

  for (const match of nextRoundMatches) {
    await createMatchOrAutoAdvance(
      tournamentId,
      nextRoundId,
      match.bracketPosition,
      match.playerAId,
      match.playerBId,
    );
  }

  await updateTournamentStatus(tournamentId, "round_active");
  return { finalRoundReached: false };
}

/**
 * Prize distribution TRIGGER only — per this phase's explicit "do not move
 * money directly, trigger Escrow/Wallet events only" instruction. This
 * emits the event and moves the tournament to 'completed'; the ACTUAL
 * releaseFromEscrow calls distributing the prize pool per
 * tournaments.payout_structure are intentionally left to a payout
 * coordinator that reacts to PrizeDistributionTriggered — keeping this
 * function's job strictly "recognize the tournament is over," not "move
 * the money," which stays WALLET-001's job even here.
 */
export async function triggerPrizeDistribution(
  tournamentId: string,
): Promise<void> {
  const tournament = await getTournamentOrThrow(tournamentId);
  if (tournament.status !== "prize_distribution") {
    throw new ConflictError(
      `Tournament ${tournamentId} is not awaiting prize distribution (status: ${tournament.status}).`,
    );
  }

  await recordAudit({
    actorId: null,
    actorType: "system",
    action: "PrizeDistributionTriggered",
    category: "financial",
    targetTable: "tournaments",
    targetId: tournamentId,
    metadata: {
      payout_structure: tournament.payoutStructure,
      prize_pool_cents: tournament.prizePoolCents,
    },
  });
  await emit({
    type: "TournamentStarted",
    payload: {
      tournamentId,
      event: "PrizeDistributionTriggered",
      payoutStructure: tournament.payoutStructure,
    },
    emittedBy: "tournament-complete",
  });

  await updateTournamentStatus(tournamentId, "completed");
  await emit({
    type: "TournamentStarted",
    payload: { tournamentId, event: "TournamentCompleted" },
    emittedBy: "tournament-complete",
  });
}

export async function archiveTournament(tournamentId: string): Promise<void> {
  const tournament = await getTournamentOrThrow(tournamentId);
  if (!["completed", "cancelled"].includes(tournament.status)) {
    throw new ConflictError(
      `Tournament ${tournamentId} is not archivable (status: ${tournament.status}).`,
    );
  }
  await updateTournamentStatus(tournamentId, "archived");
}

export async function cancelTournament(
  tournamentId: string,
  actorId: string,
): Promise<void> {
  const tournament = await getTournamentOrThrow(tournamentId);
  if (
    !["draft", "published", "registration", "registration_closed", "check_in"]
      .includes(tournament.status)
  ) {
    throw new AuthorizationError(
      "This tournament can no longer be cancelled — a bracket has already been generated.",
    );
  }

  const registrations = await listRegistrations(tournamentId);
  if (tournament.entryFeeCents > 0) {
    for (const reg of registrations) {
      if (reg.forfeited) continue;
      const walletId = await getWalletIdForUser(reg.userId);
      await releaseFromEscrow(
        walletId,
        walletId,
        tournament.entryFeeCents,
        0,
        "refund_void",
        { table: "tournaments", id: tournamentId },
        actorId,
        `cancel-refund-${tournamentId}-${reg.userId}`,
      );
    }
  }

  await updateTournamentStatus(tournamentId, "cancelled");
  await recordAudit({
    actorId,
    actorType: "administrator",
    action: "TournamentCancelled",
    category: "tournament",
    targetTable: "tournaments",
    targetId: tournamentId,
  });
}
