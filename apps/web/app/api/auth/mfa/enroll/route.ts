import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkAal2Required } from "@/lib/auth/mfa-enforcement";

/**
 * POST /api/auth/mfa/enroll
 *
 * Wires up Supabase Auth's native TOTP MFA support. Originally built as
 * unused plumbing ahead of enforcement (AUTH-001); Phase 3C now actually
 * calls this from the Security Settings "Enable MFA" flow
 * (components/settings/MfaSection.tsx), which then confirms the
 * enrollment via mfa/verify.
 *
 * Not rate-limited, unlike mfa/verify/recovery-codes/verify: this endpoint
 * has no brute-forceable secret to guess (it only generates a fresh QR
 * code/secret for an already-authenticated caller).
 *
 * Gated behind checkAal2Required (Phase 3C independent-review finding):
 * for a FIRST-time enroller this is a no-op (satisfied:true, unaffected).
 * But for an account that already has a verified factor, an attacker
 * holding only a hijacked aal1 session (e.g. a stolen cookie, who never
 * completed the real TOTP step) could otherwise call this endpoint, add
 * their own attacker-controlled factor, confirm it via mfa/verify, and
 * have that route's "first enrollment" branch hand them a freshly
 * regenerated set of recovery codes -- silently invalidating the real
 * owner's codes and planting a live backdoor, without ever possessing the
 * victim's actual authenticator. Requiring aal2 here closes that: adding a
 * factor to an already-MFA-protected account is itself a sensitive action,
 * same as disabling MFA or regenerating codes.
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

  const { satisfied, hasMfaEnrolled, error: aal2Error } = await checkAal2Required(supabase);

  if (aal2Error) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Could not verify session security level." } },
      { status: 500 },
    );
  }

  if (hasMfaEnrolled && !satisfied) {
    return NextResponse.json(
      {
        error: {
          code: "AUTH_MFA_REQUIRED",
          message: "Re-verify your existing authenticator before adding a new one.",
        },
      },
      { status: 403 },
    );
  }

  const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp" });

  if (error) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: error.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({
    data: {
      factor_id: data.id,
      secret: data.totp.secret,
      qr_url: data.totp.qr_code,
    },
  });
}
