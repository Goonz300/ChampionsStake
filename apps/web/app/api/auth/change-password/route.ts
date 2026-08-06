import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { changePasswordSchema } from "@/lib/auth/validation";
import { checkAal2Required } from "@/lib/auth/mfa-enforcement";

/**
 * POST /api/auth/change-password — for an already-authenticated user
 * changing their password from Settings, as opposed to the forgot/reset
 * flow. Re-verifies the current password before allowing the change, since
 * a valid session alone shouldn't be sufficient to silently change the
 * password on an account someone else is briefly logged into (e.g. a shared
 * device).
 *
 * Phase 3C, Milestone 4: additionally requires aal2 when the account has
 * MFA enrolled -- skipped entirely for the (majority of) accounts without
 * MFA, so this never blocks the existing password-change flow for them.
 *
 * Independent-review finding: this check MUST run before the
 * signInWithPassword() re-verification below, not after. Confirmed against
 * the pinned SDK (@supabase/auth-js's GoTrueClient.signInWithPassword)
 * that a successful password grant unconditionally saves the fresh
 * session it receives back -- a password-only grant, i.e. aal1 -- which
 * would silently strip an already-aal2 session's assurance level. Checking
 * aal2 afterward would have made this route permanently unusable for every
 * MFA-enrolled account: the very re-verification step already needed to
 * confirm the current password would always fail the aal2 gate that
 * follows it.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = changePasswordSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: parsed.error.issues[0]?.message ?? "Invalid input.",
        },
      },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) {
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

  if (hasMfaEnrolled && !satisfied) {
    return NextResponse.json(
      {
        error: {
          code: "AUTH_MFA_REQUIRED",
          message: "Re-verify your authenticator code before changing your password.",
        },
      },
      { status: 403 },
    );
  }

  const { error: verifyError } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: parsed.data.currentPassword,
  });

  if (verifyError) {
    return NextResponse.json(
      { error: { code: "AUTH_INVALID_CREDENTIALS", message: "Current password is incorrect." } },
      { status: 401 },
    );
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.newPassword });

  if (error) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: error.message } },
      { status: 400 },
    );
  }

  return NextResponse.json({ data: { changed: true } });
}
