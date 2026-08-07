// supabase/functions/_tournament/analytics.ts
//
// Phase 8 (TOURNAMENT-009): Tournament Analytics. Reuses Phase 7 M3's
// computeTournamentReputation/computeOrganizerReputation directly for
// quality signals rather than a second mechanism, and _admin/analytics.ts's
// existing tournamentVolume for platform-wide growth rather than
// duplicating that query. This module adds what's genuinely new:
// per-tournament participation/revenue/prize-efficiency/drop-off, which
// no existing function computes.

import { getServiceRoleClient } from "../_shared/database/client.ts";
import {
  computeOrganizerReputation,
  computeTournamentReputation,
} from "../_ai/reputation-engine.ts";
import {
  computeDropOffFunnel,
  computePrizeEfficiency,
  type DropOffFunnelStage,
} from "./analytics-heuristics.ts";

export interface TournamentParticipation {
  registeredCount: number;
  checkedInCount: number;
  forfeitedCount: number;
  eliminatedCount: number;
}

export async function getTournamentParticipation(
  tournamentId: string,
): Promise<TournamentParticipation> {
  const supabase = getServiceRoleClient();
  const { data } = await supabase
    .from("tournament_registrations")
    .select("checked_in_at, forfeited, eliminated")
    .eq("tournament_id", tournamentId);

  const rows = data ?? [];
  return {
    registeredCount: rows.length,
    checkedInCount: rows.filter((r) => r.checked_in_at !== null).length,
    forfeitedCount: rows.filter((r) => r.forfeited).length,
    eliminatedCount: rows.filter((r) => r.eliminated).length,
  };
}

export interface TournamentRevenue {
  totalCollectedCents: number;
  totalDistributedCents: number;
  platformRevenueCents: number;
  prizeEfficiency: number;
}

/** Total collected is registrationCount * entryFeeCents (every
 * registration locks exactly that amount, migration 0007) -- more
 * reliable than tracing wallet_ledger for this tournament specifically,
 * since wallet_transactions has no related-entity column to filter on. */
export async function getTournamentRevenue(
  tournamentId: string,
): Promise<TournamentRevenue> {
  const supabase = getServiceRoleClient();
  const { data: tournament } = await supabase
    .from("tournaments")
    .select("entry_fee_cents, prize_pool_cents")
    .eq("id", tournamentId)
    .maybeSingle();
  if (!tournament) {
    throw new Error(`Tournament ${tournamentId} does not exist.`);
  }

  const { count: registeredCount } = await supabase
    .from("tournament_registrations")
    .select("id", { count: "exact", head: true })
    .eq("tournament_id", tournamentId);

  const totalCollectedCents = (registeredCount ?? 0) *
    (tournament.entry_fee_cents as number);
  const totalDistributedCents = tournament.prize_pool_cents as number;

  return {
    totalCollectedCents,
    totalDistributedCents,
    platformRevenueCents: totalCollectedCents - totalDistributedCents,
    prizeEfficiency: computePrizeEfficiency(
      totalDistributedCents,
      totalCollectedCents,
    ),
  };
}

export async function getTournamentDropOff(
  tournamentId: string,
): Promise<DropOffFunnelStage[]> {
  const participation = await getTournamentParticipation(tournamentId);
  const stillActive = participation.registeredCount -
    participation.forfeitedCount - participation.eliminatedCount;

  return computeDropOffFunnel([
    { stage: "registered", count: participation.registeredCount },
    { stage: "checked_in", count: participation.checkedInCount },
    { stage: "still_active", count: Math.max(0, stillActive) },
  ]);
}

export interface TournamentQuality {
  tournamentReputationScore: number;
  organizerReputationScore: number;
}

/** Reuses Phase 7 M3 directly -- "Completion rate" and "Organizer
 * quality" are already computed there (tournament reputation factors in
 * completion vs cancellation; organizer reputation aggregates it across
 * an organizer's tournaments). No duplicate scoring here. */
export async function getTournamentQuality(
  tournamentId: string,
): Promise<TournamentQuality> {
  const supabase = getServiceRoleClient();
  const { data: tournament } = await supabase
    .from("tournaments")
    .select("created_by")
    .eq("id", tournamentId)
    .maybeSingle();
  if (!tournament) {
    throw new Error(`Tournament ${tournamentId} does not exist.`);
  }

  const [
    { score: tournamentReputationScore },
    { score: organizerReputationScore },
  ] = await Promise.all([
    computeTournamentReputation(tournamentId),
    computeOrganizerReputation(tournament.created_by as string),
  ]);

  return { tournamentReputationScore, organizerReputationScore };
}

export interface TournamentEcosystemHealth {
  tournamentsInWindow: number;
  completedCount: number;
  cancelledCount: number;
  completionRate: number;
  avgParticipation: number;
}

/** "Growth"/"Health metrics" at the tournament-ecosystem level (distinct
 * from Phase 7 M6's platform-wide platformHealth, which covers revenue/
 * fraud/churn/disputes, not tournament-specific completion trends). */
export async function getTournamentEcosystemHealth(
  days = 30,
): Promise<TournamentEcosystemHealth> {
  const supabase = getServiceRoleClient();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const { data: tournaments } = await supabase
    .from("tournaments")
    .select("id, status")
    .gte("created_at", since);

  const rows = tournaments ?? [];
  const completedCount = rows.filter((t) => t.status === "completed").length;
  const cancelledCount = rows.filter((t) => t.status === "cancelled").length;

  let totalParticipation = 0;
  for (const t of rows) {
    const { count } = await supabase
      .from("tournament_registrations")
      .select("id", { count: "exact", head: true })
      .eq("tournament_id", t.id);
    totalParticipation += count ?? 0;
  }

  return {
    tournamentsInWindow: rows.length,
    completedCount,
    cancelledCount,
    completionRate: rows.length > 0 ? completedCount / rows.length : 0,
    avgParticipation: rows.length > 0 ? totalParticipation / rows.length : 0,
  };
}
