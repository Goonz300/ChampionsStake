import { serverEnv } from "@/lib/env";

const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

const DEFAULT_TRIGGER_AFTER_FAILURES = 3;

function isConfigured(): boolean {
  return Boolean(serverEnv.CAPTCHA_SECRET_KEY);
}

/**
 * Layer 9 (CAPTCHA Support): NOT required by default -- only once the
 * caller's recent failure count (from the SAME count login/route.ts
 * already computes for progressive delay/lockout, not a new query) crosses
 * CAPTCHA_TRIGGER_AFTER_FAILURES. Also false whenever no provider is
 * configured (CAPTCHA_SECRET_KEY unset) -- a deployment that hasn't
 * provisioned Turnstile must not start rejecting logins outright; that
 * would turn an anti-abuse feature into an availability outage.
 */
export function shouldRequireCaptcha(recentFailureCount: number): boolean {
  if (!isConfigured()) return false;
  const threshold = Number(
    serverEnv.CAPTCHA_TRIGGER_AFTER_FAILURES ?? DEFAULT_TRIGGER_AFTER_FAILURES,
  );
  return recentFailureCount >= threshold;
}

/**
 * Cloudflare Turnstile's siteverify API -- the only provider actually wired
 * to a live HTTP call (CAPTCHA_PROVIDER defaults to "turnstile"). hCaptcha/
 * reCAPTCHA Enterprise are architecture-ready via the same
 * shouldRequireCaptcha/verifyCaptcha call shape (a provider switch could be
 * added here later) but not implemented -- matching this project's
 * established honest-scoping pattern for unimplemented providers (e.g.
 * Phase 4's push notification providers).
 */
export async function verifyCaptcha(token: string | undefined, remoteIp: string): Promise<boolean> {
  if (!isConfigured()) return true;
  if (!token) return false;

  try {
    const response = await fetch(TURNSTILE_VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        secret: serverEnv.CAPTCHA_SECRET_KEY,
        response: token,
        remoteip: remoteIp,
      }),
    });
    const result = (await response.json()) as { success?: boolean };
    return result.success === true;
  } catch (err) {
    // A CAPTCHA-provider outage must not itself lock every user out --
    // fail open, same rationale as isLoginRateLimited. The rate limit and
    // (once triggered) progressive delay/lockout remain the real gates.
    console.error("CAPTCHA verification request failed, allowing through:", err);
    return true;
  }
}
