import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { deleteAllRecoveryCodes } from "@/lib/auth/recovery-codes";
import { logSecurityEvent } from "@/lib/auth/audit";
import { notifySecurityEvent } from "@/lib/auth/security-notifications";

/**
 * POST /api/auth/mfa/disable — Phase 3C, Milestone 3. Removes every
 * verified TOTP factor and deletes recovery codes (which have nothing
 * left to be a fallback for once MFA itself is off).
 *
 * "Re-authentication before disabling" is enforced by checking the
 * session's current Authenticator Assurance Level is aal2 -- confirmed
 * against the pinned SDK: auth.mfa.unenroll() itself already requires
 * aal2 to remove a verified factor ("A user has to have an aal2
 * authenticator level in order to unenroll a verified factor"), so this
 * check surfaces a clear, specific error up front rather than relying
 * solely on Supabase's own rejection deep inside the unenroll call.
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

  const { data: aal, error: aalError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

  if (aalError) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Could not verify session security level." } },
      { status: 500 },
    );
  }

  if (aal.currentLevel !== "aal2") {
    return NextResponse.json(
      {
        error: {
          code: "AUTH_MFA_REQUIRED",
          message: "Re-verify your authenticator code before disabling MFA.",
        },
      },
      { status: 403 },
    );
  }

  const { data: factorsData, error: factorsError } = await supabase.auth.mfa.listFactors();

  if (factorsError) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Could not list MFA factors." } },
      { status: 500 },
    );
  }

  const verifiedFactors = factorsData.all.filter((f) => f.status === "verified");

  for (const factor of verifiedFactors) {
    const { error: unenrollError } = await supabase.auth.mfa.unenroll({ factorId: factor.id });
    if (unenrollError) {
      return NextResponse.json(
        { error: { code: "INTERNAL_ERROR", message: "Failed to disable MFA." } },
        { status: 500 },
      );
    }
  }

  const { error: codesError } = await deleteAllRecoveryCodes(user.id);

  if (codesError) {
    return NextResponse.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "MFA was disabled, but old recovery codes could not be cleared.",
        },
      },
      { status: 500 },
    );
  }

  await logSecurityEvent(user.id, "MfaDisabled", "profiles", user.id);
  await notifySecurityEvent(user.id, "MfaDisabled");

  return NextResponse.json({ data: { disabled: true } });
}
