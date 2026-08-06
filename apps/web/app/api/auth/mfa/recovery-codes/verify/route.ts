import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { consumeRecoveryCode } from "@/lib/auth/recovery-codes";
import { isMfaVerifyRateLimited, recordFailedMfaVerify } from "@/lib/auth/rate-limit";
import { logSecurityEvent } from "@/lib/auth/audit";
import { notifySecurityEvent } from "@/lib/auth/security-notifications";
import { markSessionMfaVerified } from "@/lib/auth/session-registry";

const recoveryCodeVerifySchema = z.object({
  code: z.string().min(1),
});

/**
 * POST /api/auth/mfa/recovery-codes/verify — Phase 3C, Milestone 2/4.
 * Alternate to mfa/verify for completing login when the user's
 * authenticator isn't available. Does NOT promote the session to GoTrue's
 * aal2 (impossible -- GoTrue has no concept of a recovery code; see
 * mfa-enforcement.ts). This lets a user finish logging in without their
 * device, but sensitive actions (disable MFA, regenerate codes, password
 * change) still require a real TOTP re-verification -- a considered
 * security stance, not a gap.
 *
 * Rate-limited the same fail-closed way as mfa/verify, keyed by user id
 * (there's no factorId in this flow -- the user is proving identity via a
 * code, not a specific enrolled factor).
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = recoveryCodeVerifySchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "A recovery code is required." } },
      { status: 400 },
    );
  }

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

  if (await isMfaVerifyRateLimited(user.id)) {
    return NextResponse.json(
      {
        error: {
          code: "RATE_LIMIT_EXCEEDED",
          message: "Too many failed attempts. Try again in a few minutes.",
        },
      },
      { status: 429, headers: { "Retry-After": "900" } },
    );
  }

  const { success, error } = await consumeRecoveryCode(user.id, parsed.data.code);

  if (error) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to verify recovery code." } },
      { status: 500 },
    );
  }

  if (!success) {
    await recordFailedMfaVerify(user.id);
    // Deliberately the same generic message whether the code was wrong or
    // already used -- consumeRecoveryCode's own doc comment explains why:
    // distinguishing the two would let an attacker enumerate code state.
    return NextResponse.json(
      { error: { code: "AUTH_MFA_REQUIRED", message: "Invalid or already-used recovery code." } },
      { status: 400 },
    );
  }

  await logSecurityEvent(user.id, "RecoveryCodeUsed", "mfa_recovery_codes", user.id);
  await notifySecurityEvent(user.id, "RecoveryCodeUsed");
  // Unlike mfa/verify, this endpoint has no "reauth" use case -- the
  // disable/regenerate routes both require real aal2 and never accept a
  // recovery code, so every call here is a login completing.
  await notifySecurityEvent(user.id, "NewLogin");

  // GoTrue's own aal2 can never reflect a recovery-code login (see
  // recovery-codes.ts's doc comments) -- mark this session's row directly
  // (migration 0074) so middleware.ts's MFA gate has a signal to check
  // besides aal2, closing the "mfa_required was returned but nothing ever
  // enforced it" gap this endpoint exists to fix (independent-review
  // finding). Session cookies were already written by the original
  // signInWithPassword call in /api/auth/login; this call does not create a
  // new session, so the tokens returned below are that same session's.
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (session) {
    await markSessionMfaVerified(session.refresh_token);
  }

  return NextResponse.json({
    data: {
      verified: true,
      access_token: session?.access_token ?? null,
      refresh_token: session?.refresh_token ?? null,
      user: { id: user.id, email: user.email },
    },
  });
}
