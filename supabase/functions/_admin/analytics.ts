// supabase/functions/_admin/analytics.ts
// All real aggregate queries against existing tables -- no new tracking
// infrastructure. "Retention" is approximated as a simple returning-user
// proxy (users with >1 completed challenge), stated explicitly since a
// true cohort-retention model is a deeper analytics-phase concern.

import { getServiceRoleClient } from "../_shared/database/client.ts";

export async function userGrowth(days: number) {
  const supabase = getServiceRoleClient();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase.from("profiles").select("created_at").gte("created_at", since);
  if (error) throw new Error(error.message);

  const byDay: Record<string, number> = {};
  for (const row of data ?? []) {
    const day = row.created_at.slice(0, 10);
    byDay[day] = (byDay[day] ?? 0) + 1;
  }
  return byDay;
}

export async function challengeVolume(days: number) {
  const supabase = getServiceRoleClient();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase.from("challenges").select("created_at, status").gte("created_at", since);
  if (error) throw new Error(error.message);
  return { total: (data ?? []).length, byStatus: countBy(data ?? [], "status") };
}

export async function tournamentVolume(days: number) {
  const supabase = getServiceRoleClient();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase.from("tournaments").select("created_at, status, format").gte("created_at", since);
  if (error) throw new Error(error.message);
  return { total: (data ?? []).length, byFormat: countBy(data ?? [], "format") };
}

export async function revenue(days: number) {
  const supabase = getServiceRoleClient();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("wallet_ledger")
    .select("amount_cents")
    .eq("account_type", "platform_fee_revenue")
    .eq("direction", "credit")
    .gte("created_at", since);
  if (error) throw new Error(error.message);
  return { totalFeeCents: (data ?? []).reduce((s, r) => s + r.amount_cents, 0) };
}

export async function escrowStatistics() {
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase.from("escrow_accounts").select("status, total_locked_cents");
  if (error) throw new Error(error.message);
  const byStatus: Record<string, { count: number; totalCents: number }> = {};
  for (const row of data ?? []) {
    byStatus[row.status] ??= { count: 0, totalCents: 0 };
    byStatus[row.status].count += 1;
    byStatus[row.status].totalCents += row.total_locked_cents;
  }
  return byStatus;
}

export async function disputeStatistics(days: number) {
  const supabase = getServiceRoleClient();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase.from("disputes").select("status, resolution, created_at").gte("created_at", since);
  if (error) throw new Error(error.message);
  return { total: (data ?? []).length, byStatus: countBy(data ?? [], "status"), byResolution: countBy(data ?? [], "resolution") };
}

/** Approximated retention proxy -- see file header note. */
export async function retentionProxy() {
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase
    .from("challenge_participants")
    .select("user_id, challenges!inner(status)")
    .eq("challenges.status", "completed");
  if (error) throw new Error(error.message);

  const counts: Record<string, number> = {};
  for (const row of data ?? []) {
    counts[row.user_id] = (counts[row.user_id] ?? 0) + 1;
  }
  const totalPlayers = Object.keys(counts).length;
  const returningPlayers = Object.values(counts).filter((c) => c > 1).length;
  return { totalPlayers, returningPlayers, retentionRate: totalPlayers > 0 ? returningPlayers / totalPlayers : 0 };
}

function countBy<T extends Record<string, unknown>>(rows: T[], key: keyof T): Record<string, number> {
  const result: Record<string, number> = {};
  for (const row of rows) {
    const value = String(row[key] ?? "unknown");
    result[value] = (result[value] ?? 0) + 1;
  }
  return result;
}
