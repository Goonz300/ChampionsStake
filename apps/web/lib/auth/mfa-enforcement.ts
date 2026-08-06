import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

/**
 * Gates a sensitive action behind a real, completed MFA challenge for this
 * session (Phase 3 Architecture Rev. 2 lineage; Phase 3C Milestone 4/10).
 *
 * Deliberately checks GoTrue's own aal2, not "did this session ever
 * consume a recovery code" -- recovery codes let a user complete LOGIN
 * without their authenticator (lib/auth/recovery-codes.ts), but they are
 * NOT treated as equivalent to a real TOTP re-verification for actions
 * this sensitive. This is a considered security stance, not an oversight:
 * an attacker who obtains one leaked recovery code should not be able to
 * use it to disable MFA entirely or mint a fresh batch of codes -- both of
 * those require the real authenticator. A user without their authenticator
 * and out of recovery codes needs account-recovery support, which is
 * outside this phase's scope.
 *
 * Skips the check entirely (returns satisfied:true) if the user has no
 * verified MFA factor at all -- this must never block the majority of
 * users who haven't enrolled in MFA from actions like changing their
 * password.
 */
export async function checkAal2Required(
  supabase: SupabaseClient<Database>,
): Promise<{ satisfied: boolean; hasMfaEnrolled: boolean; error: Error | null }> {
  const { data: factorsData, error: factorsError } = await supabase.auth.mfa.listFactors();

  if (factorsError) {
    return { satisfied: false, hasMfaEnrolled: false, error: factorsError };
  }

  const hasMfaEnrolled = factorsData.totp.length > 0;

  if (!hasMfaEnrolled) {
    return { satisfied: true, hasMfaEnrolled: false, error: null };
  }

  const { data: aal, error: aalError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

  if (aalError) {
    return { satisfied: false, hasMfaEnrolled: true, error: aalError };
  }

  return { satisfied: aal.currentLevel === "aal2", hasMfaEnrolled: true, error: null };
}
