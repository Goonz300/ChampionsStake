// supabase/functions/_realtime/spectator.ts
//
// Phase 8 (TOURNAMENT-008): Spectator Platform. "Never build another
// websocket system" -- broadcastTournamentActivity mirrors typing.ts's
// exact established pattern (getServiceRoleClient().channel(name).send),
// same Realtime Broadcast feature, same <domain>:<entityId> channel
// naming convention this codebase already uses for chat. Live
// brackets/standings/leaderboards are Postgres Changes on tables now in
// the supabase_realtime publication (migration 0101) -- no broadcast
// needed for those, the same way chat messages themselves don't need one
// (they're a table write; typing indicators are the thing that needed
// Broadcast specifically because persisting them would be pure overhead).

import { getServiceRoleClient } from "../_shared/database/client.ts";

// Deliberately NOT instantiated at module top level (unlike most other
// _*/service.ts files in this codebase) -- this module is imported by
// _tournament/workflow.ts, which workflow.test.ts also imports for its
// pure functions (computePayoutShares etc.). A top-level
// getServiceRoleClient() call throws immediately in a test environment
// with no live Supabase env vars, which would poison that entire test
// file on import alone, the same class of bug already caught once in
// Phase 8 M2 (_team/service.ts's slugify) -- there the fix was moving the
// pure function to its own file; here the fix is matching typing.ts's own
// actual pattern (call getServiceRoleClient() inside each function, not
// at module scope), which this file failed to do correctly the first time.

export type TournamentActivityEvent =
  | "round_started"
  | "round_completed"
  | "match_completed"
  | "prize_distributed"
  | "no_show"
  | "tournament_completed";

/**
 * Fire-and-forget live activity ping for a tournament's spectator channel.
 * Never the source of truth (that's always the underlying table row/
 * domain_events entry this is broadcast alongside, not instead of) --
 * purely a low-latency "something just happened, go refetch" signal, the
 * same role typing indicators play for chat.
 */
export async function broadcastTournamentActivity(
  tournamentId: string,
  event: TournamentActivityEvent,
  payload: Record<string, unknown> = {},
): Promise<void> {
  const channel = getServiceRoleClient().channel(`tournament:${tournamentId}`);
  await channel.send({
    type: "broadcast",
    event,
    payload: { tournamentId, ...payload, timestamp: new Date().toISOString() },
  });
}

export interface MatchTimelineEntry {
  matchId: string;
  roundNumber: number;
  bracketPosition: number;
  challengeId: string | null;
  status: string | null;
  winnerId: string | null;
  completedAt: string | null;
}

/**
 * "Match timeline": tournament_matches joined with their underlying
 * challenge's outcome, chronological -- reuses the existing bracket
 * structure and challenge status rather than a new events-log table.
 */
export async function getMatchTimeline(
  tournamentId: string,
): Promise<MatchTimelineEntry[]> {
  const supabase = getServiceRoleClient();
  const { data: rounds, error: roundsError } = await supabase
    .from("tournament_rounds")
    .select("id, round_number")
    .eq("tournament_id", tournamentId);
  if (roundsError) {
    throw new Error(
      `Failed to fetch tournament rounds: ${roundsError.message}`,
    );
  }
  if (!rounds || rounds.length === 0) return [];

  const roundNumberById = new Map(
    rounds.map((r) => [r.id as string, r.round_number as number]),
  );

  const { data: matches, error: matchesError } = await supabase
    .from("tournament_matches")
    .select(
      "id, round_id, bracket_position, challenge_id, challenges(status, winner_submitted_by, completed_at)",
    )
    .in("round_id", rounds.map((r) => r.id));
  if (matchesError) {
    throw new Error(
      `Failed to fetch tournament matches: ${matchesError.message}`,
    );
  }

  const entries: MatchTimelineEntry[] = (matches ?? []).map((m) => {
    // PostgREST returns a single embedded object for this to-one
    // relationship (challenge_id -> challenges) at runtime, but the
    // untyped query builder (no generated Database types in this
    // codebase) infers embedded resources as arrays -- cast through
    // unknown, matching this exact ambiguity, rather than claim a false
    // direct overlap.
    const challenge = m.challenges as unknown as {
      status: string | null;
      winner_submitted_by: string | null;
      completed_at: string | null;
    } | null;
    return {
      matchId: m.id as string,
      roundNumber: roundNumberById.get(m.round_id as string) ?? 0,
      bracketPosition: m.bracket_position as number,
      challengeId: m.challenge_id as string | null,
      status: challenge?.status ?? null,
      winnerId: challenge?.winner_submitted_by ?? null,
      completedAt: challenge?.completed_at ?? null,
    };
  });

  return entries.sort((a, b) => {
    const aTime = a.completedAt ?? "";
    const bTime = b.completedAt ?? "";
    return bTime.localeCompare(aTime);
  });
}

const TOURNAMENT_ACTIVITY_EVENT_TYPES = [
  "TournamentStarted",
  "TournamentRoundCompleted",
  "TournamentPrizeDistributionTriggered",
  "TournamentPrizesDistributed",
  "TournamentCompleted",
  "TournamentNoShowRecorded",
];

export interface TournamentActivityLogEntry {
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

/**
 * "Tournament activity" (durable log, distinct from the ephemeral
 * broadcast above): reuses the existing domain_events log rather than a
 * new activity table. Filtered by event type + a bounded time window at
 * the DB level, then by payload.tournamentId in application code --
 * deliberately not a JSON-path DB filter (e.g. payload->>tournamentId),
 * since this codebase has no established precedent for that exact
 * PostgREST query shape and this environment can't verify it against a
 * live instance (same caution already applied in Phase 8 M3/M5's repository
 * modules). A bounded window keeps the unfiltered fetch small.
 */
export async function getTournamentActivityLog(
  tournamentId: string,
  hours = 24 * 30,
  limit = 100,
): Promise<TournamentActivityLogEntry[]> {
  const supabase = getServiceRoleClient();
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("domain_events")
    .select("event_type, payload, created_at")
    .in("event_type", TOURNAMENT_ACTIVITY_EVENT_TYPES)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(limit * 5); // over-fetch before the in-app tournamentId filter narrows it

  if (error) {
    throw new Error(`Failed to fetch tournament activity: ${error.message}`);
  }

  return (data ?? [])
    .filter((row) =>
      (row.payload as Record<string, unknown>)?.tournamentId === tournamentId
    )
    .slice(0, limit)
    .map((row) => ({
      type: row.event_type as string,
      payload: row.payload as Record<string, unknown>,
      createdAt: row.created_at as string,
    }));
}
