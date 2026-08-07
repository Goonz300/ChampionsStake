// supabase/functions/_tournament/repository.ts

import { getServiceRoleClient } from "../_shared/database/client.ts";
import { NotFoundError } from "../_shared/errors/index.ts";
import type { Registration, Tournament } from "./types.ts";

function toTournament(row: Record<string, unknown>): Tournament {
  return {
    id: row.id as string,
    gameId: row.game_id as string,
    name: row.name as string,
    format: row.format as Tournament["format"],
    entryFeeCents: row.entry_fee_cents as number,
    prizePoolCents: row.prize_pool_cents as number,
    payoutStructure: row.payout_structure as Record<string, number>,
    status: row.status as Tournament["status"],
    createdBy: row.created_by as string,
    visibility: row.visibility as Tournament["visibility"],
  };
}

export async function getTournamentOrThrow(
  tournamentId: string,
): Promise<Tournament> {
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase.from("tournaments").select("*").eq(
    "id",
    tournamentId,
  ).maybeSingle();
  if (error) {
    throw new Error(
      `Failed to fetch tournament ${tournamentId}: ${error.message}`,
    );
  }
  if (!data) {
    throw new NotFoundError(`Tournament ${tournamentId} does not exist.`);
  }
  return toTournament(data);
}

export async function updateTournamentStatus(
  tournamentId: string,
  status: string,
): Promise<void> {
  const supabase = getServiceRoleClient();
  const { error } = await supabase.from("tournaments").update({ status }).eq(
    "id",
    tournamentId,
  );
  // Subject to fn_tournament_state_guard — an illegal transition raises a
  // Postgres error here, surfaced as a generic Error by the caller.
  if (error) {
    throw new Error(
      `Failed to update tournament ${tournamentId} status: ${error.message}`,
    );
  }
}

export async function listRegistrations(
  tournamentId: string,
): Promise<Registration[]> {
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase
    .from("tournament_registrations")
    .select("*")
    .eq("tournament_id", tournamentId);

  if (error) throw new Error(`Failed to list registrations: ${error.message}`);
  return (data ?? []).map((r) => ({
    tournamentId: r.tournament_id,
    userId: r.user_id,
    seed: r.seed,
    checkedInAt: r.checked_in_at,
    eliminated: r.eliminated,
    forfeited: r.forfeited,
  }));
}

export async function getRegistration(
  tournamentId: string,
  userId: string,
): Promise<Registration | null> {
  const supabase = getServiceRoleClient();
  const { data } = await supabase
    .from("tournament_registrations")
    .select("*")
    .eq("tournament_id", tournamentId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!data) return null;
  return {
    tournamentId: data.tournament_id,
    userId: data.user_id,
    seed: data.seed,
    checkedInAt: data.checked_in_at,
    eliminated: data.eliminated,
    forfeited: data.forfeited,
  };
}

export async function createRound(
  tournamentId: string,
  roundNumber: number,
  name: string,
) {
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase
    .from("tournament_rounds")
    .insert({
      tournament_id: tournamentId,
      round_number: roundNumber,
      name,
      status: "pending",
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`Failed to create round ${roundNumber}: ${error?.message}`);
  }
  return data.id as string;
}

export async function getCurrentRound(tournamentId: string) {
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase
    .from("tournament_rounds")
    .select("*")
    .eq("tournament_id", tournamentId)
    .order("round_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`Failed to fetch current round: ${error.message}`);
  if (!data) {
    throw new NotFoundError(
      `No rounds exist yet for tournament ${tournamentId}.`,
    );
  }
  return data;
}

export async function updateRoundStatus(
  roundId: string,
  status: string,
): Promise<void> {
  const supabase = getServiceRoleClient();
  await supabase.from("tournament_rounds").update({ status }).eq("id", roundId);
}

export async function listMatchesForRound(roundId: string) {
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase
    .from("tournament_matches")
    .select(
      "*, challenges(id, status, winner_submitted_by, creator_id, opponent_id)",
    )
    .eq("round_id", roundId);

  if (error) {
    throw new Error(
      `Failed to list matches for round ${roundId}: ${error.message}`,
    );
  }
  return data ?? [];
}
