// supabase/functions/_admin/users.ts
//
// suspendUser is the one place this phase adds real new orchestration:
// Business Rules §2 requires in-flight challenges to be auto-cancelled with
// full refund when an account is suspended. It reuses this phase's own
// forceCancelChallenge (which itself reuses WALLET-001's releaseFromEscrow)
// rather than reimplementing refund logic a third time.

import { getServiceRoleClient } from "../_shared/database/client.ts";
import { ConflictError, NotFoundError } from "../_shared/errors/index.ts";
import { recordAudit } from "../_shared/audit/index.ts";
import { getBalance } from "../_wallet/service.ts";
import { forceCancelChallenge } from "./challenges.ts";

export async function searchUsers(
  query: { search?: string; status?: string; limit: number; cursor?: string },
) {
  const supabase = getServiceRoleClient();
  let q = supabase
    .from("profiles")
    .select(
      "id, display_name, role, status, kyc_status, trust_score, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(query.limit);

  if (query.search) q = q.ilike("display_name", `%${query.search}%`);
  if (query.status) q = q.eq("status", query.status);
  if (query.cursor) q = q.lt("created_at", query.cursor);

  const { data, error } = await q;
  if (error) throw new Error(`Failed to search users: ${error.message}`);
  return data ?? [];
}

const NON_TERMINAL_CHALLENGE_STATUSES = [
  "draft",
  "published",
  "waiting",
  "accepted",
  "escrow_pending",
  "escrow_locked",
  "ready",
  "countdown",
  "live",
  "winner_submitted",
  "awaiting_confirmation",
];

export async function suspendUser(
  userId: string,
  reasonCode: string,
  notes: string,
  adminId: string,
): Promise<{ cancelledChallenges: number }> {
  const supabase = getServiceRoleClient();

  const { data: profile } = await supabase.from("profiles").select("status").eq(
    "id",
    userId,
  ).maybeSingle();
  if (!profile) throw new NotFoundError(`User ${userId} not found.`);
  if (profile.status === "suspended") {
    throw new ConflictError("This user is already suspended.");
  }

  const { error } = await supabase
    .from("profiles")
    .update({
      status: "suspended",
      suspended_at: new Date().toISOString(),
      suspended_reason_code: reasonCode,
    })
    .eq("id", userId);
  if (error) throw new Error(`Failed to suspend user: ${error.message}`);

  const { data: participations } = await supabase
    .from("challenge_participants")
    .select("challenge_id, challenges!inner(status)")
    .eq("user_id", userId)
    .in("challenges.status", NON_TERMINAL_CHALLENGE_STATUSES);

  let cancelledCount = 0;
  for (const p of participations ?? []) {
    try {
      await forceCancelChallenge(
        p.challenge_id,
        adminId,
        `Account suspended: ${reasonCode}`,
      );
      cancelledCount += 1;
    } catch {
      // A challenge already in a non-force-cancellable state (e.g. live)
      // is left for the moderator/dispute path -- not silently retried
      // here, and not a reason to fail the whole suspension.
    }
  }

  await recordAudit({
    actorId: adminId,
    actorType: "administrator",
    action: "AccountSuspended",
    category: "admin",
    targetTable: "profiles",
    targetId: userId,
    metadata: {
      reason_code: reasonCode,
      notes,
      cancelled_challenges: cancelledCount,
    },
  });

  return { cancelledChallenges: cancelledCount };
}

export async function reinstateUser(
  userId: string,
  adminId: string,
): Promise<void> {
  const supabase = getServiceRoleClient();
  const { data: profile } = await supabase.from("profiles").select("status").eq(
    "id",
    userId,
  ).maybeSingle();
  if (!profile) throw new NotFoundError(`User ${userId} not found.`);
  if (profile.status !== "suspended") {
    throw new ConflictError("This user is not currently suspended.");
  }

  const { error } = await supabase
    .from("profiles")
    .update({
      status: "active",
      suspended_at: null,
      suspended_reason_code: null,
    })
    .eq("id", userId);
  if (error) throw new Error(`Failed to reinstate user: ${error.message}`);

  await recordAudit({
    actorId: adminId,
    actorType: "administrator",
    action: "AccountReinstated",
    category: "admin",
    targetTable: "profiles",
    targetId: userId,
  });
}

export async function getUserSummary(userId: string) {
  const supabase = getServiceRoleClient();
  const { data: profile, error } = await supabase.from("profiles").select("*")
    .eq("id", userId).maybeSingle();
  if (error || !profile) throw new NotFoundError(`User ${userId} not found.`);

  const wallet = await getBalance(userId).catch(() => null);

  const { data: matchHistory } = await supabase
    .from("challenge_participants")
    .select(
      "challenge_id, role, challenges(status, stake_cents, created_at, completed_at)",
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(50);

  const { data: tournamentHistory } = await supabase
    .from("tournament_registrations")
    .select(
      "tournament_id, seed, eliminated, forfeited, tournaments(name, status)",
    )
    .eq("user_id", userId)
    .limit(50);

  const { data: auditTimeline } = await supabase
    .from("audit_logs")
    .select("*")
    .eq("actor_id", userId)
    .order("created_at", { ascending: false })
    .limit(50);

  return {
    profile,
    wallet,
    matchHistory: matchHistory ?? [],
    tournamentHistory: tournamentHistory ?? [],
    auditTimeline: auditTimeline ?? [],
  };
}
