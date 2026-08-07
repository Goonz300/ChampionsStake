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
import { getClientIp } from "../_shared/security/client-ip.ts";
import {
  getMatchTimeline,
  getTournamentActivityLog,
} from "../_realtime/spectator.ts";
import { getTournamentIcsFeed } from "../_tournament/scheduling.ts";

const querySchema = z.object({
  view: z.enum([
    "list",
    "bracket",
    "standings",
    "participants",
    "match_timeline",
    "activity",
    "ics",
  ]).default("list"),
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

    // Phase 8 (TOURNAMENT-007): private tournaments were never filtered
    // out of this list at all before organizer-created private/invite-only
    // tournaments existed -- a real gap this milestone's own new visibility
    // column surfaced. A caller sees public tournaments, invite_only
    // tournaments (visible, but registration itself is still gated --
    // see registerForTournament), and their OWN private/invite_only
    // tournaments; administrators see everything.
    const isAdmin = ctx.profile?.role === "administrator";
    if (!isAdmin) {
      const callerId = ctx.user?.id;
      q = callerId
        ? q.or(`visibility.neq.private,created_by.eq.${callerId}`)
        : q.eq("visibility", "public");
    }

    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return successResponse(data ?? []);
  }

  if (!query.tournamentId) {
    throw new ValidationError(
      "tournamentId is required for bracket/standings/participants views.",
    );
  }

  if (query.view === "ics") {
    const ics = await getTournamentIcsFeed(query.tournamentId);
    return new Response(ics, {
      status: 200,
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": "attachment; filename=tournament.ics",
      },
    });
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

  if (query.view === "match_timeline") {
    return successResponse(await getMatchTimeline(query.tournamentId));
  }
  if (query.view === "activity") {
    return successResponse(await getTournamentActivityLog(query.tournamentId));
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
    {
      functionName: "tournament-browse",
      auth: "optional",
      rateLimit: (ctx) => ({
        key: `tournament-browse:${
          ctx.user?.id ?? `ip:${getClientIp(ctx.request) ?? "unknown"}`
        }`,
        windowSeconds: 60,
        maxRequests: 60,
      }),
    },
    handler,
  ),
);
