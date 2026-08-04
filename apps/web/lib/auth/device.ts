import { createHash } from "node:crypto";
import { createServiceRoleClient } from "@/lib/supabase/server";

/**
 * Derives a stable device fingerprint from request headers. This is a
 * pragmatic v1 fingerprint (user-agent + accept-language + a truncated IP),
 * not a full browser-fingerprinting solution — sufficient to support the
 * multi-account/fraud-detection signal in Business Rules §14 without
 * introducing a third-party fingerprinting script.
 */
export function deriveDeviceFingerprint(userAgent: string, acceptLanguage: string, ipAddress: string): string {
  const ipPrefix = ipAddress.split(".").slice(0, 3).join("."); // /24-ish granularity, not exact IP
  return createHash("sha256").update(`${userAgent}|${acceptLanguage}|${ipPrefix}`).digest("hex");
}

/**
 * Upserts a device record for the user. Runs as service_role because
 * `devices` has no client INSERT policy (DB-002: "fingerprints are recorded
 * server-side at login").
 */
export async function recordDevice(
  userId: string,
  fingerprint: string,
  platform: string | null,
): Promise<void> {
  const supabase = createServiceRoleClient();

  const { data: existing } = await supabase
    .from("devices")
    .select("id")
    .eq("user_id", userId)
    .eq("device_fingerprint", fingerprint)
    .maybeSingle();

  if (existing) {
    await supabase
      .from("devices")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("id", existing.id);
  } else {
    await supabase.from("devices").insert({
      user_id: userId,
      device_fingerprint: fingerprint,
      platform,
    });
  }
}
