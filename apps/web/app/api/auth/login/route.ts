import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { loginSchema } from "@/lib/auth/validation";
import { isLoginRateLimited, recordFailedLogin } from "@/lib/auth/rate-limit";
import { deriveDeviceFingerprint, recordDevice } from "@/lib/auth/device";
import { recordSession } from "@/lib/auth/session-registry";

function getClientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "0.0.0.0"
  );
}

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
    return NextResponse.json(
      { error: { code: "AUTH_INVALID_CREDENTIALS", message: "Invalid email or password." } },
      { status: 401 },
    );
  }

  const userAgent = request.headers.get("user-agent") ?? "";
  const acceptLanguage = request.headers.get("accept-language") ?? "";
  const fingerprint = deriveDeviceFingerprint(userAgent, acceptLanguage, ipAddress);

  const { deviceId } = await recordDevice(data.user.id, fingerprint, null, userAgent);
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

  return NextResponse.json({
    data: {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      user: { id: data.user.id, email: data.user.email },
    },
  });
}
