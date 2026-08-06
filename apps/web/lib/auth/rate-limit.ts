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
export async function isLoginRateLimited(email: string, ipAddress: string): Promise<boolean> {
  const supabase = createServiceRoleClient();

  const since = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000).toISOString();

  const { count, error } = await supabase
    .from("audit_logs")
    .select("id", { count: "exact", head: true })
    .eq("action", "LoginFailed")
    .gte("created_at", since)
    .contains("metadata", { email, ip_address: ipAddress });

  if (error) {
    // Fail OPEN on a rate-limit-check error would be the wrong default for
    // a security control, but failing CLOSED (blocking all logins) on a
    // transient DB error is equally bad for availability. We log and allow
    // the attempt through, relying on Supabase Auth's own internal
    // protections as a backstop, rather than taking the whole login flow
    // down because a monitoring query failed.
    console.error("Rate-limit check failed, allowing login attempt through:", error);
    return false;
  }

  return (count ?? 0) >= MAX_ATTEMPTS;
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
export async function isMfaVerifyRateLimited(factorId: string): Promise<boolean> {
  const supabase = createServiceRoleClient();

  const since = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000).toISOString();

  const { count, error } = await supabase
    .from("audit_logs")
    .select("id", { count: "exact", head: true })
    .eq("action", "MfaVerifyFailed")
    .gte("created_at", since)
    .contains("metadata", { factor_id: factorId });

  if (error) {
    console.error("MFA rate-limit check failed, blocking the attempt (fail closed):", error);
    return true;
  }

  return (count ?? 0) >= MAX_ATTEMPTS;
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
