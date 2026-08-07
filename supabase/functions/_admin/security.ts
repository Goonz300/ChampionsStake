// supabase/functions/_admin/security.ts
//
// Layer 16 (Administration). Read/action surface over this phase's own new
// tables (login_lockouts, device_ip_history) plus the pre-existing
// fraud_flags -- reused via _ai/fraud-detection.ts's listFraudFlags/
// reviewFlag rather than a second implementation of "list open flags."

import { getServiceRoleClient } from "../_shared/database/client.ts";
import { recordAudit } from "../_shared/audit/index.ts";

export interface LockedAccountRow {
  email: string;
  ip_address: string;
  locked_until: string;
  lock_count: number;
  locked_at: string;
}

/** Currently-locked identities (Layer 8's login_lockouts, migration 0079).
 * "Currently" means locked_until is still in the future -- an expired row
 * is left in place (automatic unlock is read-time, see lockout.ts on the
 * web side) but not surfaced here as "locked". */
export async function listLockedAccounts(
  limit = 50,
): Promise<LockedAccountRow[]> {
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase
    .from("login_lockouts")
    .select("email, ip_address, locked_until, lock_count, locked_at")
    .gt("locked_until", new Date().toISOString())
    .order("locked_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to list locked accounts: ${error.message}`);
  }
  return data ?? [];
}

/** Deletes every lockout row for the email (all source IPs). login/route.ts
 * normalizes email to lowercase before ever writing a login_lockouts row
 * (hostile-review fix -- see its own comment for why: rate limiting/
 * lockout/CAPTCHA are all keyed by email, and email auth is inherently
 * case-insensitive, so an unnormalized key would have been bypassable by
 * rotating casing), so every row here is already lowercase -- normalizing
 * the admin's input the same way here too means an unlock actually matches
 * regardless of how the admin typed the email, rather than silently
 * deleting zero rows on a casing mismatch. */
export async function unlockAccount(
  email: string,
  adminId: string,
): Promise<void> {
  const normalizedEmail = email.trim().toLowerCase();
  const supabase = getServiceRoleClient();
  await supabase.from("login_lockouts").delete().eq("email", normalizedEmail);

  await recordAudit({
    actorId: adminId,
    actorType: "administrator",
    action: "AccountUnlocked",
    category: "auth",
    targetTable: "profiles",
    targetId: email,
    metadata: { email },
  });
}

export interface AbuseStats {
  window_hours: number;
  failed_logins: number;
  failed_mfa_verifications: number;
  accounts_locked: number;
  auth_action_rate_limited_attempts: number;
  open_fraud_flags: number;
}

/** Coarse "recent abuse" counters (Layer 16: "viewing recent abuse"), drawn
 * from audit_logs (already the canonical event log every check in this
 * phase writes to) rather than a new metrics table. */
export async function getAbuseStats(hours = 24): Promise<AbuseStats> {
  const supabase = getServiceRoleClient();
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

  const countFor = async (action: string): Promise<number> => {
    const { count } = await supabase
      .from("audit_logs")
      .select("id", { count: "exact", head: true })
      .eq("action", action)
      .gte("created_at", since);
    return count ?? 0;
  };

  const [failedLogins, failedMfa, accountsLocked, authActions, openFlags] =
    await Promise.all([
      countFor("LoginFailed"),
      countFor("MfaVerifyFailed"),
      countFor("AccountLocked"),
      countFor("AuthActionAttempted"),
      supabase
        .from("fraud_flags")
        .select("id", { count: "exact", head: true })
        .eq("status", "open")
        .then((r) => r.count ?? 0),
    ]);

  return {
    window_hours: hours,
    failed_logins: failedLogins,
    failed_mfa_verifications: failedMfa,
    accounts_locked: accountsLocked,
    auth_action_rate_limited_attempts: authActions,
    open_fraud_flags: openFlags,
  };
}
