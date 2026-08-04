// supabase/functions/_admin/tournaments.ts
// Every write here is a direct pass-through to TOURNAMENT-001's existing
// functions -- no bracket, registration, or prize logic is duplicated.

import { getServiceRoleClient } from "../_shared/database/client.ts";
import { archiveTournament, cancelTournament } from "../_tournament/workflow.ts";

export const adminArchiveTournament = archiveTournament;
export const adminCancelTournament = cancelTournament;

export async function adminBrowseTournaments(filters: { status?: string; limit: number; cursor?: string }) {
  const supabase = getServiceRoleClient();
  let query = supabase.from("tournaments").select("*").order("created_at", { ascending: false }).limit(filters.limit);
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.cursor) query = query.lt("created_at", filters.cursor);

  const { data, error } = await query;
  if (error) throw new Error(`Failed to browse tournaments: ${error.message}`);
  return data ?? [];
}

export async function adminGetBracket(tournamentId: string) {
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase
    .from("tournament_rounds")
    .select("*, tournament_matches(*, challenges(id, status, winner_submitted_by, creator_id, opponent_id))")
    .eq("tournament_id", tournamentId)
    .order("round_number", { ascending: true });
  if (error) throw new Error(`Failed to fetch bracket: ${error.message}`);
  return data ?? [];
}

export async function adminGetRegistrations(tournamentId: string) {
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase
    .from("tournament_registrations")
    .select("*, profiles(display_name, trust_score)")
    .eq("tournament_id", tournamentId)
    .order("seed", { ascending: true });
  if (error) throw new Error(`Failed to fetch registrations: ${error.message}`);
  return data ?? [];
}

export async function adminGetPrizeStatus(tournamentId: string) {
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase
    .from("tournaments")
    .select("status, prize_pool_cents, payout_structure")
    .eq("id", tournamentId)
    .single();
  if (error) throw new Error(`Failed to fetch prize status: ${error.message}`);
  return data;
}
