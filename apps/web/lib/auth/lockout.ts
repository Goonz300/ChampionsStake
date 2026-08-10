import { createServiceRoleClient } from "@/lib/supabase/server";
import { serverEnv } from "@/lib/env";
import { logger } from "@/lib/logger";

const DEFAULT_FAILURES_TO_LOCK = 5;
const DEFAULT_INITIAL_LOCKOUT_MINUTES = 15;
const DEFAULT_MAX_LOCKOUT_MINUTES = 1440;

function getLockoutConfig() {
  return {
    failuresToLock: Number(serverEnv.LOCKOUT_FAILURES_TO_LOCK ?? DEFAULT_FAILURES_TO_LOCK),
    initialLockoutMinutes: Number(
      serverEnv.LOCKOUT_INITIAL_MINUTES ?? DEFAULT_INITIAL_LOCKOUT_MINUTES,
    ),
    maxLockoutMinutes: Number(serverEnv.LOCKOUT_MAX_MINUTES ?? DEFAULT_MAX_LOCKOUT_MINUTES),
  };
}

export interface LockoutStatus {
  locked: boolean;
  lockedUntil: string | null;
}

/**
 * Layer 8 (Account Lockout). Keyed by (email, ip_address) -- see migration
 * 0079's header comment for why this is not keyed by user_id. "Automatic
 * unlock" (a named Layer 8 requirement) is just locked_until having
 * elapsed -- checked here at read time, no sweep job needed.
 */
export async function isAccountLocked(email: string, ipAddress: string): Promise<LockoutStatus> {
  const supabase = createServiceRoleClient();

  const { data, error } = await supabase
    .from("login_lockouts")
    .select("locked_until")
    .eq("email", email)
    .eq("ip_address", ipAddress)
    .maybeSingle();

  if (error) {
    // Same fail-open rationale as isLoginRateLimited: a broken lockout-state
    // query must not itself take the whole login flow down. The rolling
    // rate limit (which fails open the same way, for the same reason)
    // remains the backstop.
    logger.error("Lockout check failed, allowing the attempt through", {
      email,
      error: error.message,
    });
    return { locked: false, lockedUntil: null };
  }

  if (!data || new Date(data.locked_until) <= new Date()) {
    return { locked: false, lockedUntil: null };
  }

  return { locked: true, lockedUntil: data.locked_until };
}

/**
 * Called once recordFailedLogin's running count reaches the configured
 * threshold. Doubles the lockout duration on each repeated lockout for the
 * same identity, capped at maxLockoutMinutes -- "repeated lockouts increase
 * duration" is a named Layer 8 requirement.
 */
export async function recordLockout(email: string, ipAddress: string): Promise<void> {
  const supabase = createServiceRoleClient();
  const { initialLockoutMinutes, maxLockoutMinutes } = getLockoutConfig();

  const { data: existing } = await supabase
    .from("login_lockouts")
    .select("lock_count")
    .eq("email", email)
    .eq("ip_address", ipAddress)
    .maybeSingle();

  const lockCount = (existing?.lock_count ?? 0) + 1;
  const durationMinutes = Math.min(initialLockoutMinutes * 2 ** (lockCount - 1), maxLockoutMinutes);
  const lockedUntil = new Date(Date.now() + durationMinutes * 60 * 1000).toISOString();

  await supabase.from("login_lockouts").upsert(
    {
      email,
      ip_address: ipAddress,
      locked_until: lockedUntil,
      lock_count: lockCount,
      locked_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "email,ip_address" },
  );

  // Every lock is audited (Layer 8: "audit every lock"). No actor_id --
  // same reasoning as recordFailedLogin, this identity is (email, ip), not
  // necessarily a real authenticated user.
  await supabase.rpc("fn_write_audit_log", {
    p_actor_id: null,
    p_actor_type: "user",
    p_action: "AccountLocked",
    p_category: "auth",
    p_target_table: "profiles",
    p_target_id: email,
    p_metadata: { email, ip_address: ipAddress, locked_until: lockedUntil, lock_count: lockCount },
  });
}

/** Should this failure trigger a new lockout? */
export function shouldLock(recentFailureCount: number): boolean {
  return recentFailureCount >= getLockoutConfig().failuresToLock;
}

// Administrator unlock (Layer 16) is implemented on the Edge/admin side
// (supabase/functions/_admin/security.ts's unlockAccount), reachable via
// /api/admin/security -- not here. An earlier version of this file also
// had a web-side clearLockoutsForEmail, but nothing ever called it (the
// admin-security Edge Function became the actual wired path); removed as
// dead code during this phase's hostile review rather than left as an
// unused, never-exercised duplicate of the same delete-and-audit logic.
