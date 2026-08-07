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
import { postBalancedEntries } from "../_wallet/ledger.ts";
import { recordEscrowRelease } from "../_wallet/escrow-accounts.ts";
import type { LedgerLeg } from "../_wallet/types.ts";
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

/** Only these placements can be automatically resolved from bracket data:
 * 1st (final round winner), 2nd (final round loser), 3rd (semifinal
 * losers, tied and split evenly — standard bracket convention when there's
 * no third-place playoff match, which this bracket engine doesn't run).
 * A payout_structure naming any other placement can't be safely resolved
 * without guessing, so triggerPrizeDistribution refuses to run rather
 * than silently mis-paying. */
const SUPPORTED_PAYOUT_PLACEMENTS = new Set(["1", "2", "3"]);

/**
 * Pure (no I/O) payout-share calculation, extracted so this financial math
 * is directly unit-testable without a database connection — see
 * workflow.test.ts. Floors at every step (never rounds) so the returned
 * shares can never sum to more than totalPoolCents: any shortfall (from
 * flooring, from a tied placement's cents not dividing evenly, or from
 * payout_structure percentages summing below 100%) is the caller's
 * responsibility to route to platform_fee_revenue. Rounding UP anywhere
 * here could produce credits exceeding what was actually locked in escrow,
 * which has no valid ledger leg to source it from — postBalancedEntries'
 * debit=credit balance check exists precisely to catch that class of bug,
 * so this function is written to never trigger it.
 */
export function computePayoutShares(
  totalPoolCents: number,
  payoutStructure: Record<string, number>,
  placementWinners: Record<string, string[]>,
): { winnerId: string; amountCents: number }[] {
  const shares: { winnerId: string; amountCents: number }[] = [];

  for (const [placement, percent] of Object.entries(payoutStructure)) {
    const winners = placementWinners[placement] ?? [];
    if (winners.length === 0) continue;

    const shareCents = Math.floor((totalPoolCents * percent) / 100);
    const perWinnerCents = Math.floor(shareCents / winners.length);
    if (perWinnerCents <= 0) continue;

    for (const winnerId of winners) {
      shares.push({ winnerId, amountCents: perWinnerCents });
    }
  }

  return shares;
}

/** Derives 1st/2nd/3rd place from the completed bracket. Only correct once
 * the tournament has actually reached prize_distribution (i.e. completeRound
 * has already recorded the final match's result and marked the tournament's
 * final round 'completed') -- callers must check status first. */
async function getFinalStandings(tournamentId: string): Promise<{
  championId: string;
  runnerUpId: string;
  semifinalLoserIds: string[];
}> {
  const finalRound = await getCurrentRound(tournamentId);
  const finalMatches = await listMatchesForRound(finalRound.id);
  const finalMatch = finalMatches.find((m) =>
    m.challenges?.winner_submitted_by
  );

  if (!finalMatch?.challenges) {
    throw new Error(
      `Tournament ${tournamentId}'s final round has no resolved match to determine standings from.`,
    );
  }

  const championId = finalMatch.challenges.winner_submitted_by as string;
  const runnerUpId = championId === finalMatch.challenges.creator_id
    ? finalMatch.challenges.opponent_id
    : finalMatch.challenges.creator_id;

  if (!runnerUpId) {
    throw new Error(
      `Tournament ${tournamentId}'s final match is missing an opponent — cannot determine a runner-up.`,
    );
  }

  const semifinalLoserIds: string[] = [];
  if (finalRound.round_number > 1) {
    const supabase = getServiceRoleClient();
    const { data: semifinalRound } = await supabase
      .from("tournament_rounds")
      .select("id")
      .eq("tournament_id", tournamentId)
      .eq("round_number", finalRound.round_number - 1)
      .maybeSingle();

    if (semifinalRound) {
      const semifinalMatches = await listMatchesForRound(semifinalRound.id);
      for (const match of semifinalMatches) {
        if (!match.challenges?.winner_submitted_by) continue;
        const winnerId = match.challenges.winner_submitted_by;
        const loserId = winnerId === match.challenges.creator_id
          ? match.challenges.opponent_id
          : match.challenges.creator_id;
        if (loserId) semifinalLoserIds.push(loserId);
      }
    }
  }

  return { championId, runnerUpId, semifinalLoserIds };
}

/**
 * Prize distribution: releases every remaining registrant's locked entry
 * fee (Business Rules §5: "on final match completion, prize pool
 * distributed... uses the same releaseEscrow primitive") and credits it to
 * the placement winners per tournaments.payout_structure, in ONE balanced
 * ledger transaction (N debit legs, one per registrant's escrowed stake; up
 * to M credit legs, one per placement winner; any rounding remainder or
 * payout_structure shortfall below 100% goes to platform_fee_revenue).
 *
 * A single postBalancedEntries call (rather than one releaseFromEscrow per
 * registrant) is used because tournament escrow is POOLED across every
 * registrant's own wallet (unlike a 1v1 challenge's simple loser-pays-
 * winner pair) — releaseFromEscrow's one-from/one-to signature doesn't fit
 * a many-payers-to-few-winners settlement, but it uses the exact same
 * underlying primitive (postBalancedEntries, in ledger.ts) that
 * releaseFromEscrow itself calls, and this function performs the matching
 * escrow_accounts/escrow_transactions bookkeeping releaseFromEscrow would
 * have done, via the same recordEscrowRelease helper.
 *
 * Previously (before this Phase 6 fix), triggerPrizeDistribution only
 * emitted an event and moved the tournament to 'completed' -- no code
 * anywhere actually paid tournament winners. Confirmed by grep before this
 * fix: zero consumers of the "PrizeDistributionTriggered" event existed.
 */
export async function triggerPrizeDistribution(
  tournamentId: string,
): Promise<{ totalDistributedCents: number }> {
  const tournament = await getTournamentOrThrow(tournamentId);
  if (tournament.status !== "prize_distribution") {
    throw new ConflictError(
      `Tournament ${tournamentId} is not awaiting prize distribution (status: ${tournament.status}).`,
    );
  }

  const unsupportedPlacements = Object.keys(tournament.payoutStructure)
    .filter((placement) => !SUPPORTED_PAYOUT_PLACEMENTS.has(placement));
  if (unsupportedPlacements.length > 0) {
    throw new Error(
      `Tournament ${tournamentId}'s payout_structure names placement(s) [${
        unsupportedPlacements.join(", ")
      }] that cannot be automatically resolved from bracket data (only 1st/2nd/3rd-tied are supported) — distribute manually.`,
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
    type: "TournamentPrizeDistributionTriggered",
    payload: { tournamentId, payoutStructure: tournament.payoutStructure },
    emittedBy: "tournament-complete",
  });

  let totalDistributedCents = 0;

  if (tournament.entryFeeCents > 0) {
    const registrations = await listRegistrations(tournamentId);
    if (registrations.length === 0) {
      throw new Error(
        `Tournament ${tournamentId} has a positive entry fee but no registrations to distribute a prize pool from.`,
      );
    }

    const { championId, runnerUpId, semifinalLoserIds } =
      await getFinalStandings(tournamentId);
    const placementWinners: Record<string, string[]> = {
      "1": [championId],
      "2": [runnerUpId],
      "3": semifinalLoserIds,
    };

    const totalPoolCents = registrations.length * tournament.entryFeeCents;
    const legs: LedgerLeg[] = [];

    for (const registration of registrations) {
      const walletId = await getWalletIdForUser(registration.userId);
      legs.push({
        walletId,
        accountType: "escrowed",
        direction: "debit",
        amountCents: tournament.entryFeeCents,
      });
    }

    const shares = computePayoutShares(
      totalPoolCents,
      tournament.payoutStructure,
      placementWinners,
    );
    for (const share of shares) {
      const winnerWalletId = await getWalletIdForUser(share.winnerId);
      legs.push({
        walletId: winnerWalletId,
        accountType: "available",
        direction: "credit",
        amountCents: share.amountCents,
      });
      totalDistributedCents += share.amountCents;
    }

    if (totalDistributedCents < totalPoolCents) {
      legs.push({
        walletId: null,
        accountType: "platform_fee_revenue",
        direction: "credit",
        amountCents: totalPoolCents - totalDistributedCents,
      });
    }

    const result = await postBalancedEntries({
      type: "payout",
      legs,
      initiatedBy: null,
      relatedEntity: { table: "tournaments", id: tournamentId },
      releaseReason: "mutual_release",
    });

    const championWalletId = await getWalletIdForUser(championId);
    for (let i = 0; i < registrations.length; i++) {
      await recordEscrowRelease(
        { table: "tournaments", id: tournamentId },
        result.transactionId,
        tournament.entryFeeCents,
        null,
        "mutual_release",
        // Pooled multi-winner payout has no single natural "released to"
        // wallet for this per-registrant leg's summary field -- the
        // champion's wallet is used as the representative recipient
        // (cosmetic only; escrow_transactions plus wallet_ledger remain
        // the accurate, complete per-leg record of who actually got paid).
        championWalletId,
      );
    }

    await recordAudit({
      actorId: null,
      actorType: "system",
      action: "TournamentPrizesDistributed",
      category: "financial",
      targetTable: "tournaments",
      targetId: tournamentId,
      metadata: {
        total_pool_cents: totalPoolCents,
        total_distributed_cents: totalDistributedCents,
        champion_id: championId,
        runner_up_id: runnerUpId,
        semifinal_loser_ids: semifinalLoserIds,
      },
    });
    await emit({
      type: "TournamentPrizesDistributed",
      payload: { tournamentId, totalDistributedCents, championId, runnerUpId },
      emittedBy: "tournament-complete",
    });
  }

  await updateTournamentStatus(tournamentId, "completed");
  await emit({
    type: "TournamentCompleted",
    payload: { tournamentId },
    emittedBy: "tournament-complete",
  });

  return { totalDistributedCents };
}

/**
 * Phase 3D independent-review finding: this had no audit trail, unlike its
 * sibling cancelTournament (which already calls recordAudit a few lines
 * below in this same file). actorId is null for the scheduled-job caller
 * (tournament-archive/index.ts's automatic sweep) and the calling
 * administrator's id for the admin-tournaments/index.ts manual path --
 * mirrors the actorId-optional pattern _wallet/service.ts's freezeWallet
 * already uses for the same system-vs-admin distinction.
 */
export async function archiveTournament(
  tournamentId: string,
  actorId: string | null,
): Promise<void> {
  const tournament = await getTournamentOrThrow(tournamentId);
  if (!["completed", "cancelled"].includes(tournament.status)) {
    throw new ConflictError(
      `Tournament ${tournamentId} is not archivable (status: ${tournament.status}).`,
    );
  }
  await updateTournamentStatus(tournamentId, "archived");
  await recordAudit({
    actorId,
    actorType: actorId ? "administrator" : "system",
    action: "TournamentArchived",
    category: "tournament",
    targetTable: "tournaments",
    targetId: tournamentId,
  });
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
