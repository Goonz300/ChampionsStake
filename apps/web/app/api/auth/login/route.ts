import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { loginSchema } from "@/lib/auth/validation";
import { getLoginFailureCount, isLoginRateLimited, recordFailedLogin } from "@/lib/auth/rate-limit";
import { deriveDeviceFingerprint, recordDevice } from "@/lib/auth/device";
import { recordSession } from "@/lib/auth/session-registry";
import { notifySecurityEvent } from "@/lib/auth/security-notifications";
import { getClientIp } from "@/lib/security/client-ip";
import { delay, getProgressiveDelayMs } from "@/lib/security/progressive-delay";
import { isAccountLocked, recordLockout, shouldLock } from "@/lib/auth/lockout";

/**
 * POST /api/auth/login
 * Business Rules §2/§16: 5 failed attempts / 15 minutes / account+IP.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);

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

  const { email, password } = parsed.data;
  const ipAddress = getClientIp(request);
  // NOTE on "Remember Me": Supabase's session cookie lifetime is governed by
  // the refresh token's own expiry (Architecture §8: 7 days), which is not
  // varied per login today. A true "sign out when the browser closes" path
  // for rememberMe=false would require overriding the cookie's maxAge at
  // write time, which @supabase/ssr's helper does not expose per-call. This
  // is a known, documented simplification for this phase rather than a
  // silently-dropped requirement — see the AUTH-001 deliverable doc.

  // Layer 8: checked before anything else -- a locked identity is rejected
  // outright rather than merely delayed/rate-limited. Automatic unlock is
  // just locked_until elapsing (see lockout.ts).
  const lockout = await isAccountLocked(email, ipAddress);
  if (lockout.locked) {
    const retryAfterSeconds = lockout.lockedUntil
      ? Math.max(1, Math.ceil((new Date(lockout.lockedUntil).getTime() - Date.now()) / 1000))
      : 900;
    return NextResponse.json(
      {
        error: {
          code: "ACCOUNT_LOCKED",
          message: "This account is temporarily locked due to repeated failed attempts.",
        },
      },
      { status: 423, headers: { "Retry-After": String(retryAfterSeconds) } },
    );
  }

  const priorFailureCount = await getLoginFailureCount(email, ipAddress);

  // Layer 7: a speed bump ahead of the hard limit below -- each recent
  // failure for this email+IP adds latency before this attempt is even
  // evaluated, independent of whether the hard limit has been reached yet.
  await delay(getProgressiveDelayMs(priorFailureCount));

  if (await isLoginRateLimited(email, ipAddress)) {
    return NextResponse.json(
      {
        error: {
          code: "RATE_LIMIT_EXCEEDED",
          message: "Too many failed login attempts. Try again in a few minutes.",
        },
      },
      { status: 429, headers: { "Retry-After": "900" } },
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !data.session || !data.user) {
    await recordFailedLogin(email, ipAddress);
    // Layer 8: the failure that just landed brings the count to
    // priorFailureCount + 1 -- lock once that crosses the configured
    // threshold, rather than re-querying for a count we can compute.
    if (shouldLock(priorFailureCount + 1)) {
      await recordLockout(email, ipAddress);
    }
    return NextResponse.json(
      { error: { code: "AUTH_INVALID_CREDENTIALS", message: "Invalid email or password." } },
      { status: 401 },
    );
  }

  const userAgent = request.headers.get("user-agent") ?? "";
  const acceptLanguage = request.headers.get("accept-language") ?? "";
  const fingerprint = deriveDeviceFingerprint(userAgent, acceptLanguage, ipAddress);

  // Layer 5: CF-IPCountry is set by Cloudflare itself (Layer 1 assumption)
  // -- no external GeoIP lookup performed; null when not present.
  const countryCode = request.headers.get("cf-ipcountry");
  const { deviceId } = await recordDevice(
    data.user.id,
    fingerprint,
    null,
    userAgent,
    ipAddress,
    countryCode,
  );
  await recordSession(
    data.user.id,
    data.session.refresh_token,
    ipAddress,
    userAgent,
    new Date(
      data.session.expires_at
        ? data.session.expires_at * 1000
        : Date.now() + 7 * 24 * 60 * 60 * 1000,
    ),
    deviceId,
  );

  // Phase 3C, Milestone 4: if this account has a verified MFA factor,
  // password verification alone does not complete login. The session
  // cookie is already set at this point (a side effect of
  // signInWithPassword on the cookie-writing client) at GoTrue's own
  // aal1 -- returning mfa_required tells the client not to treat login as
  // finished until it calls mfa/verify or recovery-codes/verify, both of
  // which fire the NewLogin notification themselves once login actually
  // completes. This route deliberately does not fire NewLogin in the
  // mfa_required branch below, since login hasn't finished yet.
  const { data: factorsData } = await supabase.auth.mfa.listFactors();
  const verifiedFactor = factorsData?.totp.find((f) => f.status === "verified");

  if (verifiedFactor) {
    return NextResponse.json({
      data: { mfa_required: true, factor_id: verifiedFactor.id },
    });
  }

  await notifySecurityEvent(data.user.id, "NewLogin", { ip_address: ipAddress });

  return NextResponse.json({
    data: {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      user: { id: data.user.id, email: data.user.email },
    },
  });
}
