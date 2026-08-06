import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { registerSchema } from "@/lib/auth/validation";
import { isAuthActionRateLimited, recordAuthAction } from "@/lib/auth/rate-limit";
import { deriveDeviceFingerprint, recordDevice } from "@/lib/auth/device";
import { getClientIp } from "@/lib/security/client-ip";
import { checkDeviceFarming } from "@/lib/security/device-farming";

/**
 * POST /api/auth/register
 * Business Rules §2: account is created 'unverified'; the identity-sync
 * trigger (migration 0029) creates the profile/wallet/preferences rows
 * automatically the instant Supabase Auth inserts into auth.users — this
 * route does not duplicate that logic, it only validates input and calls
 * supabase.auth.signUp().
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = registerSchema.safeParse(body);

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

  const { email, password, displayName } = parsed.data;
  const ipAddress = getClientIp(request);

  // Layer 3: register was previously entirely unprotected (verified by
  // grep before this phase -- only login and mfa/verify had a limiter).
  if (await isAuthActionRateLimited("register", ipAddress)) {
    return NextResponse.json(
      {
        error: {
          code: "RATE_LIMIT_EXCEEDED",
          message: "Too many registration attempts from this address. Try again later.",
        },
      },
      { status: 429, headers: { "Retry-After": "900" } },
    );
  }
  await recordAuthAction("register", ipAddress);

  const supabase = await createClient();

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { display_name: displayName },
      emailRedirectTo: `${new URL(request.url).origin}/auth/callback?next=/verify-email`,
    },
  });

  if (error) {
    const isDuplicate = error.message.toLowerCase().includes("already registered");
    return NextResponse.json(
      {
        error: {
          code: isDuplicate ? "AUTH_EMAIL_ALREADY_EXISTS" : "VALIDATION_ERROR",
          message: isDuplicate ? "An account with this email already exists." : error.message,
        },
      },
      { status: isDuplicate ? 409 : 400 },
    );
  }

  // Layer 5/6: mass account creation / device farming detection -- flags
  // only, never blocks (see device-farming.ts). Best-effort: a failure here
  // must never fail the registration that already succeeded above.
  if (data.user) {
    try {
      const userAgent = request.headers.get("user-agent") ?? "";
      const acceptLanguage = request.headers.get("accept-language") ?? "";
      const countryCode = request.headers.get("cf-ipcountry");
      const fingerprint = deriveDeviceFingerprint(userAgent, acceptLanguage, ipAddress);
      await recordDevice(data.user.id, fingerprint, null, userAgent, ipAddress, countryCode);
      await checkDeviceFarming(data.user.id, fingerprint);
    } catch (err) {
      console.error("Device farming check failed (non-fatal):", err);
    }
  }

  return NextResponse.json(
    { data: { user_id: data.user?.id, status: "unverified" } },
    { status: 201 },
  );
}
