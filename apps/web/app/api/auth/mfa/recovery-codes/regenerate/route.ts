import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { regenerateRecoveryCodes } from "@/lib/auth/recovery-codes";
import { checkAal2Required } from "@/lib/auth/mfa-enforcement";
import { logSecurityEvent } from "@/lib/auth/audit";
import { notifySecurityEvent } from "@/lib/auth/security-notifications";

/**
 * POST /api/auth/mfa/recovery-codes/regenerate — Phase 3C, Milestone 2/3.
 * Requires real aal2 (see mfa-enforcement.ts's doc comment for why a
 * recovery-code-based login does not satisfy this): a single leaked
 * recovery code must not be usable to mint a fresh, unlimited batch and
 * lock the real owner out, or to keep permanent access after the owner
 * rotates their codes.
 */
export async function POST() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { error: { code: "AUTH_INVALID_CREDENTIALS", message: "Not authenticated." } },
      { status: 401 },
    );
  }

  const { satisfied, hasMfaEnrolled, error: aalError } = await checkAal2Required(supabase);

  if (aalError) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Could not verify session security level." } },
      { status: 500 },
    );
  }

  if (!hasMfaEnrolled) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "MFA is not enabled on this account." } },
      { status: 400 },
    );
  }

  if (!satisfied) {
    return NextResponse.json(
      {
        error: {
          code: "AUTH_MFA_REQUIRED",
          message: "Re-verify your authenticator code before regenerating recovery codes.",
        },
      },
      { status: 403 },
    );
  }

  const { codes, error: codesError } = await regenerateRecoveryCodes(user.id);

  if (codesError) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to regenerate recovery codes." } },
      { status: 500 },
    );
  }

  await logSecurityEvent(user.id, "RecoveryCodesRegenerated", "mfa_recovery_codes", user.id);
  await notifySecurityEvent(user.id, "RecoveryCodesRegenerated");

  return NextResponse.json({ data: { recovery_codes: codes } });
}
