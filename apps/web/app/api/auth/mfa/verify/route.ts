import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import {
  getMfaVerifyFailureCount,
  isMfaVerifyRateLimited,
  recordFailedMfaVerify,
} from "@/lib/auth/rate-limit";
import { regenerateRecoveryCodes } from "@/lib/auth/recovery-codes";
import { logSecurityEvent } from "@/lib/auth/audit";
import { notifySecurityEvent } from "@/lib/auth/security-notifications";
import { delay, getProgressiveDelayMs } from "@/lib/security/progressive-delay";

const mfaVerifySchema = z.object({
  factorId: z.string().min(1),
  code: z.string().length(6),
  // Not a security/authorization signal (never trusted for that -- see
  // wasUnverified below, which IS checked server-side) -- purely tells us
  // whether to fire the NewLogin notification. The same verify call shape
  // is used both to complete a login and to step up mid-session before a
  // sensitive action (e.g. re-authenticating right before mfa/disable);
  // only the caller knows which one this is.
  context: z.enum(["login", "reauth"]).default("reauth"),
});

/**
 * POST /api/auth/mfa/verify — Phase 3C, extending the Phase 3A/AUTH-001
 * plumbing rather than replacing it: verifying a code against a challenge
 * (lines below unchanged in shape) is exactly what BOTH confirms a new
 * enrollment and re-verifies an already-enrolled factor during a step-up.
 * Distinguished server-side (never trusting client-supplied context) by
 * checking the target factor's status via listFactors() before the
 * verify call -- 'unverified' means this call is confirming enrollment,
 * per Supabase's own factor lifecycle.
 *
 * Rate-limited (fail-closed, Phase 3 Architecture Rev. 2, §5 -- see
 * rate-limit.ts's isMfaVerifyRateLimited for why this is the opposite
 * fail-safe direction from login's limiter).
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = mfaVerifySchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "factorId and a 6-digit code are required." } },
      { status: 400 },
    );
  }

  const { factorId, code, context } = parsed.data;

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

  // Layer 7: speed bump ahead of the hard (fail-closed) limit below.
  await delay(getProgressiveDelayMs(await getMfaVerifyFailureCount(factorId)));

  if (await isMfaVerifyRateLimited(factorId)) {
    return NextResponse.json(
      {
        error: {
          code: "RATE_LIMIT_EXCEEDED",
          message: "Too many failed verification attempts. Try again in a few minutes.",
        },
      },
      { status: 429, headers: { "Retry-After": "900" } },
    );
  }

  const { data: factorsData } = await supabase.auth.mfa.listFactors();
  const targetFactor = factorsData?.all.find((f) => f.id === factorId);
  const wasUnverified = targetFactor?.status === "unverified";

  const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
    factorId,
  });

  if (challengeError) {
    await recordFailedMfaVerify(factorId);
    return NextResponse.json(
      { error: { code: "AUTH_MFA_REQUIRED", message: challengeError.message } },
      { status: 400 },
    );
  }

  const { error: verifyError } = await supabase.auth.mfa.verify({
    factorId,
    challengeId: challenge.id,
    code,
  });

  if (verifyError) {
    await recordFailedMfaVerify(factorId);
    return NextResponse.json(
      { error: { code: "AUTH_MFA_REQUIRED", message: "Invalid verification code." } },
      { status: 400 },
    );
  }

  if (!wasUnverified) {
    // Routine step-up verification of an already-enrolled factor -- either
    // the login-completion point for an MFA-enrolled user (login/route.ts
    // returned mfa_required instead of firing NewLogin itself), or a
    // mid-session re-auth step-up before a sensitive action (e.g. right
    // before mfa/disable). Only fire NewLogin for the former -- context is
    // client-supplied (not a security decision, just which notification
    // copy to send) and defaults to "reauth" so an old client that never
    // sends it does not get a stream of false "new login" notifications
    // for what are actually re-auth step-ups.
    if (context === "login") {
      await notifySecurityEvent(user.id, "NewLogin");
      // TOTP verification just promoted this session to GoTrue's aal2
      // natively, so no user_sessions marker is needed here (unlike the
      // recovery-code path) -- but the client still needs fresh tokens to
      // sync its browser-side session state, exactly like /api/auth/login
      // returns for the non-MFA case. Cookies were already written by the
      // original signInWithPassword call; this does not create a new
      // session.
      const {
        data: { session },
      } = await supabase.auth.getSession();

      return NextResponse.json({
        data: {
          verified: true,
          access_token: session?.access_token ?? null,
          refresh_token: session?.refresh_token ?? null,
          user: { id: user.id, email: user.email },
        },
      });
    }
    return NextResponse.json({ data: { verified: true } });
  }

  // This verify call just confirmed a NEW enrollment (Supabase's own
  // enroll() promotes the factor to verified and logs out other sessions
  // at this point, per the SDK's own documented behavior -- nothing more
  // to do for that part). Generate this account's first set of recovery
  // codes now, since they don't exist until MFA is actually confirmed
  // working (never at enroll()-call time, so a code can't leak before
  // that).
  const { codes, error: codesError } = await regenerateRecoveryCodes(user.id);

  if (codesError) {
    return NextResponse.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message:
            "MFA was enabled, but recovery codes could not be generated. Please try regenerating them from Security Settings.",
        },
      },
      { status: 500 },
    );
  }

  await logSecurityEvent(user.id, "MfaEnabled", "profiles", user.id);
  await notifySecurityEvent(user.id, "MfaEnabled");

  return NextResponse.json({
    data: { verified: true, enrolled: true, recovery_codes: codes },
  });
}
