// supabase/functions/_ai/reputation-engine.ts
//
// Phase 7 (AI-004): see migration 0089's header for the trust-vs-reputation
// distinction. Every computeXReputation function is a plain, inspectable
// sum of named factors, same "deterministic, reproducible" bar as
// elo.ts/risk-engine.ts -- not a black-box model.

import { getServiceRoleClient } from "../_shared/database/client.ts";
import {
  clampScore,
  computeExperienceFactor,
  computeModeratorReputationScore,
  computeOrganizerReputationScore,
  computePlayerReputationScore,
  computeResponseFactor,
  computeTournamentReputationScore,
} from "./reputation-heuristics.ts";

const supabase = getServiceRoleClient();

type ReputationSubjectType =
  | "player"
  | "moderator"
  | "tournament"
  | "organizer"
  | "team";

async function upsertReputationScore(
  subjectType: ReputationSubjectType,
  subjectId: string,
  score: number,
  factors: Record<string, unknown>,
): Promise<void> {
  const clamped = clampScore(score);

  const { data: existing } = await supabase
    .from("reputation_scores")
    .select("score")
    .eq("subject_type", subjectType)
    .eq("subject_id", subjectId)
    .maybeSingle();

  await supabase.from("reputation_scores").upsert(
    {
      subject_type: subjectType,
      subject_id: subjectId,
      score: clamped,
      factors,
      computed_at: new Date().toISOString(),
    },
    { onConflict: "subject_type,subject_id" },
  );

  await supabase.from("reputation_history").insert({
    subject_type: subjectType,
    subject_id: subjectId,
    old_score: existing?.score ?? null,
    new_score: clamped,
    factors,
  });
}

export interface ReputationResult {
  score: number;
  factors: Record<string, unknown>;
}

/**
 * Player reputation: consistency and performance, not fraud risk (that's
 * trust_score's job). completion_rate is an existing profiles column
 * (already surfaced publicly via v_leaderboard, migration 0013) -- reused
 * directly, not recomputed from raw challenge rows.
 */
export async function computePlayerReputation(
  userId: string,
): Promise<ReputationResult> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("completion_rate")
    .eq("id", userId)
    .maybeSingle();
  if (!profile) throw new Error(`No profile found for user ${userId}.`);

  const { count: completedChallenges } = await supabase
    .from("challenges")
    .select("id", { count: "exact", head: true })
    .or(`creator_id.eq.${userId},opponent_id.eq.${userId}`)
    .eq("status", "completed");

  const completionRate = (profile.completion_rate as number | null) ?? 0;
  const experienceFactor = computeExperienceFactor(completedChallenges ?? 0);

  const factors = {
    completionRate,
    completedChallenges: completedChallenges ?? 0,
    experienceFactor,
  };

  const score = computePlayerReputationScore(completionRate, experienceFactor);
  await upsertReputationScore("player", userId, score, factors);
  return { score, factors };
}

/**
 * Moderator reputation: appeal rate (lower is better -- an appealed
 * decision means at least one party disagreed enough to escalate) and
 * response time (evidence_deadline/decided_at already exist on disputes,
 * migration 0009 -- reused, not a new timing mechanism).
 */
export async function computeModeratorReputation(
  moderatorId: string,
): Promise<ReputationResult> {
  const { data: disputes } = await supabase
    .from("disputes")
    .select("created_at, decided_at, appeal_filed_at")
    .eq("assigned_moderator_id", moderatorId)
    .not("decided_at", "is", null)
    .limit(200);

  const rows = disputes ?? [];
  if (rows.length === 0) {
    const factors = { decidedDisputes: 0 };
    const score = 50; // neutral starting point, no track record yet
    await upsertReputationScore("moderator", moderatorId, score, factors);
    return { score, factors };
  }

  const appealedCount = rows.filter((d) => d.appeal_filed_at !== null).length;
  const appealRate = appealedCount / rows.length;

  const responseTimesHours = rows.map((d) =>
    (new Date(d.decided_at as string).getTime() -
      new Date(d.created_at as string).getTime()) / (60 * 60 * 1000)
  );
  const avgResponseHours = responseTimesHours.reduce((a, b) => a + b, 0) /
    responseTimesHours.length;
  const responseFactor = computeResponseFactor(avgResponseHours);

  const factors = {
    decidedDisputes: rows.length,
    appealRate: Math.round(appealRate * 1000) / 1000,
    avgResponseHours: Math.round(avgResponseHours * 10) / 10,
    responseFactor,
  };

  const score = computeModeratorReputationScore(appealRate, responseFactor);
  await upsertReputationScore("moderator", moderatorId, score, factors);
  return { score, factors };
}

/**
 * Tournament reputation: did it run cleanly -- reached completed rather
 * than cancelled, low forfeit/dispute rate among its matches.
 */
export async function computeTournamentReputation(
  tournamentId: string,
): Promise<ReputationResult> {
  const { data: tournament } = await supabase
    .from("tournaments")
    .select("status")
    .eq("id", tournamentId)
    .maybeSingle();
  if (!tournament) throw new Error(`No tournament found for ${tournamentId}.`);

  const { count: registrationCount } = await supabase
    .from("tournament_registrations")
    .select("id", { count: "exact", head: true })
    .eq("tournament_id", tournamentId);
  const { count: forfeitCount } = await supabase
    .from("tournament_registrations")
    .select("id", { count: "exact", head: true })
    .eq("tournament_id", tournamentId)
    .eq("forfeited", true);

  const { data: rounds } = await supabase
    .from("tournament_rounds")
    .select("id")
    .eq("tournament_id", tournamentId);
  const roundIds = (rounds ?? []).map((r) => r.id as string);

  const matches = roundIds.length > 0
    ? (await supabase
      .from("tournament_matches")
      .select("challenge_id")
      .in("round_id", roundIds)).data
    : [];

  const challengeIds = (matches ?? [])
    .map((m) => m.challenge_id)
    .filter((id): id is string => Boolean(id));
  let disputeRate = 0;
  if (challengeIds.length > 0) {
    const { count: disputedCount } = await supabase
      .from("disputes")
      .select("id", { count: "exact", head: true })
      .in("challenge_id", challengeIds);
    disputeRate = (disputedCount ?? 0) / challengeIds.length;
  }

  const forfeitRate = registrationCount
    ? (forfeitCount ?? 0) / registrationCount
    : 0;
  const completedBonus = tournament.status === "completed" ? 40 : 0;

  const factors = {
    status: tournament.status,
    registrationCount: registrationCount ?? 0,
    forfeitRate: Math.round(forfeitRate * 1000) / 1000,
    disputeRate: Math.round(disputeRate * 1000) / 1000,
    completedBonus,
  };

  const score = computeTournamentReputationScore(
    completedBonus,
    forfeitRate,
    disputeRate,
  );
  await upsertReputationScore("tournament", tournamentId, score, factors);
  return { score, factors };
}

/**
 * Organizer reputation: aggregates the reputation of tournaments a user
 * created (tournaments.created_by, an existing column -- no formal
 * "Organizer" role/table exists yet, Phase 8 M5 builds that; anyone who has
 * created a tournament already has an implicit organizer track record
 * today).
 */
export async function computeOrganizerReputation(
  organizerId: string,
): Promise<ReputationResult> {
  const { data: tournaments } = await supabase
    .from("tournaments")
    .select("id, status")
    .eq("created_by", organizerId)
    .limit(200);

  const rows = tournaments ?? [];
  if (rows.length === 0) {
    const factors = { tournamentsCreated: 0 };
    const score = 50;
    await upsertReputationScore("organizer", organizerId, score, factors);
    return { score, factors };
  }

  const cancelledCount = rows.filter((t) => t.status === "cancelled").length;
  const cancellationRate = cancelledCount / rows.length;

  const tournamentScores = await Promise.all(
    rows
      .filter((t) => t.status === "completed")
      .map((t) => computeTournamentReputation(t.id)),
  );
  const avgTournamentScore = tournamentScores.length > 0
    ? tournamentScores.reduce((sum, r) => sum + r.score, 0) /
      tournamentScores.length
    : 50;

  const factors = {
    tournamentsCreated: rows.length,
    cancellationRate: Math.round(cancellationRate * 1000) / 1000,
    avgTournamentScore: Math.round(avgTournamentScore),
  };

  const score = computeOrganizerReputationScore(
    avgTournamentScore,
    cancellationRate,
  );
  await upsertReputationScore("organizer", organizerId, score, factors);
  return { score, factors };
}

/**
 * Sweeps recently-active players/moderators/tournaments/organizers and
 * recomputes their reputation. Same bounded-window sweep philosophy as
 * trust-score.ts/fraud-detection.ts.
 */
export async function sweepReputationScores(
  hours = 24,
  limit = 200,
): Promise<
  {
    players: number;
    moderators: number;
    tournaments: number;
    organizers: number;
  }
> {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

  const { data: recentChallenges } = await supabase
    .from("challenges")
    .select("creator_id, opponent_id")
    .eq("status", "completed")
    .gte("updated_at", since)
    .limit(limit);
  const playerIds = new Set<string>();
  for (const row of recentChallenges ?? []) {
    playerIds.add(row.creator_id as string);
    if (row.opponent_id) playerIds.add(row.opponent_id as string);
  }
  for (const id of playerIds) await computePlayerReputation(id);

  const { data: recentDisputes } = await supabase
    .from("disputes")
    .select("assigned_moderator_id")
    .not("decided_at", "is", null)
    .gte("decided_at", since)
    .limit(limit);
  const moderatorIds = new Set<string>();
  for (const row of recentDisputes ?? []) {
    if (row.assigned_moderator_id) {
      moderatorIds.add(row.assigned_moderator_id as string);
    }
  }
  for (const id of moderatorIds) await computeModeratorReputation(id);

  const { data: recentTournaments } = await supabase
    .from("tournaments")
    .select("id, created_by")
    .gte("updated_at", since)
    .limit(limit);
  const organizerIds = new Set<string>();
  for (const row of recentTournaments ?? []) {
    await computeTournamentReputation(row.id as string);
    if (row.created_by) organizerIds.add(row.created_by as string);
  }
  for (const id of organizerIds) await computeOrganizerReputation(id);

  return {
    players: playerIds.size,
    moderators: moderatorIds.size,
    tournaments: (recentTournaments ?? []).length,
    organizers: organizerIds.size,
  };
}
