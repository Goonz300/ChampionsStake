// supabase/functions/tournament-browse/index.ts
// Consolidated read endpoint for Browse/Search/Bracket/Standings/
// Participants/Leaderboard — all straightforward reads that don't warrant
// 5 separate Edge Functions each doing one SELECT.

import { z } from "zod";
import {
  type EdgeContext,
  withEdgeFunction,
} from "../_shared/middleware/index.ts";
import { validateQuery } from "../_shared/validation/validate.ts";
import { successResponse } from "../_shared/response/index.ts";
import { getServiceRoleClient } from "../_shared/database/client.ts";
import { ValidationError } from "../_shared/errors/index.ts";

const querySchema = z.object({
  view: z.enum(["list", "bracket", "standings", "participants"]).default(
    "list",
  ),
  tournamentId: z.string().uuid().optional(),
  gameId: z.string().uuid().optional(),
  status: z.string().optional(),
});

async function handler(ctx: EdgeContext): Promise<Response> {
  const url = new URL(ctx.request.url);
  const query = validateQuery(querySchema, url);
  const supabase = getServiceRoleClient();

  if (query.view === "list") {
    let q = supabase.from("tournaments").select("*").order("starts_at", {
      ascending: true,
    });
    if (query.gameId) q = q.eq("game_id", query.gameId);
    if (query.status) q = q.eq("status", query.status);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return successResponse(data ?? []);
  }

  if (!query.tournamentId) {
    throw new ValidationError(
      "tournamentId is required for bracket/standings/participants views.",
    );
  }

  if (query.view === "bracket") {
    const { data, error } = await supabase
      .from("tournament_rounds")
      .select(
        "*, tournament_matches(*, challenges(id, status, winner_submitted_by, creator_id, opponent_id))",
      )
      .eq("tournament_id", query.tournamentId)
      .order("round_number", { ascending: true });
    if (error) throw new Error(error.message);
    return successResponse(data ?? []);
  }

  if (query.view === "participants" || query.view === "standings") {
    const { data, error } = await supabase
      .from("tournament_registrations")
      .select(
        "user_id, seed, checked_in_at, eliminated, forfeited, profiles(display_name, trust_score)",
      )
      .eq("tournament_id", query.tournamentId)
      .order("seed", { ascending: true });
    if (error) throw new Error(error.message);
    return successResponse(data ?? []);
  }

  throw new ValidationError(`Unsupported view: ${query.view}`);
}

Deno.serve(
  withEdgeFunction(
    { functionName: "tournament-browse", auth: "optional" },
    handler,
  ),
);
