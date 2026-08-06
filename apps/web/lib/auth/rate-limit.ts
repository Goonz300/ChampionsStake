import { createServiceRoleClient } from "@/lib/supabase/server";

const WINDOW_MINUTES = 15;
const MAX_ATTEMPTS = 5;

/**
 * Login rate limiting (Business Rules §2/§16: 5 attempts / 15 minutes per
 * account+IP). Backed by audit_logs (category='auth', action='LoginFailed')
 * rather than a dedicated table, since audit_logs already exists and is the
 * canonical place security events land.
 *
 * Architecture §7 anticipates Upstash Redis for rate limiting generally
 * (better suited to high-frequency endpoints like deposit/dispute). This
 * Postgres-backed check is a deliberately simpler mechanism appropriate for
 * login's lower request volume, and is what's actually implemented here
 * since Upstash provisioning is outside this phase's scope (no
 * UPSTASH_REDIS_URL is required to be configured for auth to function).
 * If/when Upstash is wired up, this function's signature can stay the same
 * and the implementation can swap without touching callers.
 */
/**
 * Shared by isLoginRateLimited/isMfaVerifyRateLimited (the pass/fail check)
 * and the progressive-delay helper (lib/security/progressive-delay.ts),
 * which needs the actual count rather than a boolean to look up how long to
 * delay. Returns null on a query error so each caller can apply its own
 * fail-open/fail-closed policy rather than this shared helper picking one
 * for both.
 */
async function countRecentFailures(
  action: "LoginFailed" | "MfaVerifyFailed",
  metadataMatch: Record<string, string>,
): Promise<number | null> {
  const supabase = createServiceRoleClient();
  const since = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000).toISOString();

  const { count, error } = await supabase
    .from("audit_logs")
    .select("id", { count: "exact", head: true })
    .eq("action", action)
    .gte("created_at", since)
    .contains("metadata", metadataMatch);

  if (error) {
    console.error(`Failure-count query failed for action=${action}:`, error);
    return null;
  }

  return count ?? 0;
}

/** Recent failure count for progressive delay -- 0 (not an error state) on
 * a query failure, since a delay is a UX/velocity control, not the primary
 * defense (isLoginRateLimited is), and failing open here is the right
 * default for the same availability reasons documented below. */
export async function getLoginFailureCount(email: string, ipAddress: string): Promise<number> {
  return (await countRecentFailures("LoginFailed", { email, ip_address: ipAddress })) ?? 0;
}

export async function isLoginRateLimited(email: string, ipAddress: string): Promise<boolean> {
  const count = await countRecentFailures("LoginFailed", { email, ip_address: ipAddress });

  if (count === null) {
    // Fail OPEN on a rate-limit-check error would be the wrong default for
    // a security control, but failing CLOSED (blocking all logins) on a
    // transient DB error is equally bad for availability. We log and allow
    // the attempt through, relying on Supabase Auth's own internal
    // protections as a backstop, rather than taking the whole login flow
    // down because a monitoring query failed.
    return false;
  }

  return count >= MAX_ATTEMPTS;
}

export async function recordFailedLogin(email: string, ipAddress: string): Promise<void> {
  const supabase = createServiceRoleClient();

  await supabase.rpc("fn_write_audit_log", {
    p_actor_id: null,
    p_actor_type: "user",
    p_action: "LoginFailed",
    p_category: "auth",
    p_target_table: "profiles",
    p_target_id: email,
    p_metadata: { email, ip_address: ipAddress },
  });
}

/**
 * MFA verification rate limiting (Phase 3 Architecture Rev. 2, §5), same
 * shape as isLoginRateLimited but keyed by factorId (the caller is already
 * authenticated at this point, unlike login) and, deliberately, the
 * opposite fail-safe direction: login fails OPEN on a rate-limit-check
 * error because it's a first-line, high-availability-priority control,
 * where a false positive locks a legitimate user out of the front door.
 * mfa/verify is the LAST line of defense against account takeover for an
 * already-password-verified session -- failing open here would remove
 * brute-force resistance on a 6-digit TOTP code (1,000,000 possibilities)
 * at exactly the moment a DB hiccup (or an attacker deliberately inducing
 * one) might also be degrading other defenses. A false positive here costs
 * a legitimate user one retry after a transient error; a false negative
 * costs an account.
 */
/** See getLoginFailureCount -- same rationale, 0 on query error. Failing
 * open on the COUNT used only for delay sizing is fine even though
 * isMfaVerifyRateLimited itself fails closed on the same query error: a
 * missed delay just means a faster-than-intended retry, not a bypassed
 * attempt-count limit (that check runs separately, below). */
export async function getMfaVerifyFailureCount(factorId: string): Promise<number> {
  return (await countRecentFailures("MfaVerifyFailed", { factor_id: factorId })) ?? 0;
}

export async function isMfaVerifyRateLimited(factorId: string): Promise<boolean> {
  const count = await countRecentFailures("MfaVerifyFailed", { factor_id: factorId });

  if (count === null) {
    console.error("MFA rate-limit check failed, blocking the attempt (fail closed).");
    return true;
  }

  return count >= MAX_ATTEMPTS;
}

export async function recordFailedMfaVerify(factorId: string): Promise<void> {
  const supabase = createServiceRoleClient();

  await supabase.rpc("fn_write_audit_log", {
    p_actor_id: null,
    p_actor_type: "user",
    p_action: "MfaVerifyFailed",
    p_category: "auth",
    p_target_table: "profiles",
    p_target_id: factorId,
    p_metadata: { factor_id: factorId },
  });
}
