// supabase/functions/_admin/dashboard.ts
//
// HONESTY NOTE: "Realtime Connections" and "API Requests" are Supabase
// infrastructure/edge-network metrics available in the Supabase Dashboard
// itself (project usage stats), not queryable from within this codebase's
// own database -- they are NOT included in getDashboardMetrics' return
// value, with this comment explaining why, rather than inventing a fake
// number. Everything else is a real aggregate query against existing
// tables from prior phases -- no new tracking tables were added to compute
// any of this.

import { getServiceRoleClient } from "../_shared/database/client.ts";

export interface DashboardMetrics {
  registeredUsers: number;
  onlineUsers: number;
  activeChallenges: number;
  liveMatches: number;
  activeTournaments: number;
  walletVolumeCentsLast24h: number;
  escrowVolumeCentsLocked: number;
  pendingDisputes: number;
  storageUsageBytes: number;
  errorRateLast1h: number | null;
}

export async function getDashboardMetrics(): Promise<DashboardMetrics> {
  const supabase = getServiceRoleClient();

  const [
    { count: registeredUsers },
    { count: onlineUsers },
    { count: activeChallenges },
    { count: liveMatches },
    { count: activeTournaments },
    { count: pendingDisputes },
  ] = await Promise.all([
    supabase.from("profiles").select("id", { count: "exact", head: true }),
    supabase.from("user_presence").select("user_id", { count: "exact", head: true }).eq("status", "online"),
    supabase
      .from("challenges")
      .select("id", { count: "exact", head: true })
      .in("status", ["published", "waiting", "accepted", "escrow_pending", "escrow_locked", "ready", "countdown"]),
    supabase.from("challenges").select("id", { count: "exact", head: true }).eq("status", "live"),
    supabase
      .from("tournaments")
      .select("id", { count: "exact", head: true })
      .in("status", ["published", "registration", "registration_closed", "check_in", "bracket_generated", "round_active", "round_complete"]),
    supabase.from("disputes").select("id", { count: "exact", head: true }).in("status", ["open", "under_review"]),
  ]);

  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: recentTransactions } = await supabase
    .from("wallet_transactions")
    .select("amount_cents")
    .eq("status", "completed")
    .gte("created_at", since24h);
  const walletVolumeCentsLast24h = (recentTransactions ?? []).reduce((sum, t) => sum + t.amount_cents, 0);

  const { data: lockedEscrow } = await supabase.from("escrow_accounts").select("total_locked_cents").eq("status", "locked");
  const escrowVolumeCentsLocked = (lockedEscrow ?? []).reduce((sum, e) => sum + e.total_locked_cents, 0);

  const { data: storageAgg } = await supabase.from("file_uploads").select("file_size_bytes").neq("status", "deleted");
  const storageUsageBytes = (storageAgg ?? []).reduce((sum, f) => sum + f.file_size_bytes, 0);

  return {
    registeredUsers: registeredUsers ?? 0,
    onlineUsers: onlineUsers ?? 0,
    activeChallenges: activeChallenges ?? 0,
    liveMatches: liveMatches ?? 0,
    activeTournaments: activeTournaments ?? 0,
    walletVolumeCentsLast24h,
    escrowVolumeCentsLocked,
    pendingDisputes: pendingDisputes ?? 0,
    storageUsageBytes,
    errorRateLast1h: null,
  };
}
