import { createHash } from "node:crypto";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { notifySecurityEvent } from "@/lib/auth/security-notifications";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

/**
 * Derives a stable device fingerprint from request headers. This is a
 * pragmatic v1 fingerprint (user-agent + accept-language + a truncated IP),
 * not a full browser-fingerprinting solution — sufficient to support the
 * multi-account/fraud-detection signal in Business Rules §14 without
 * introducing a third-party fingerprinting script.
 */
export function deriveDeviceFingerprint(
  userAgent: string,
  acceptLanguage: string,
  ipAddress: string,
): string {
  const ipPrefix = ipAddress.split(".").slice(0, 3).join("."); // /24-ish granularity, not exact IP
  return createHash("sha256").update(`${userAgent}|${acceptLanguage}|${ipPrefix}`).digest("hex");
}

export interface RecordDeviceResult {
  /** Null only if the insert itself failed -- logged, never thrown. */
  deviceId: string | null;
  isNewDevice: boolean;
}

/**
 * Layer 5 (Device Fingerprinting -- IP history). One row per login, not
 * just first-seen, since multi-account/account-farming detection needs the
 * recent IP set for a device, not just devices.last_ip_address's single
 * most-recent value (migration 0080). Fire-and-isolate, same as the
 * NewDeviceLogin audit call below -- never fails the login itself.
 */
async function recordDeviceIpHistory(
  deviceId: string,
  ipAddress: string | null,
  countryCode: string | null,
): Promise<void> {
  if (!ipAddress) return;
  const supabase = createServiceRoleClient();
  try {
    await supabase.from("device_ip_history").insert({
      device_id: deviceId,
      ip_address: ipAddress,
      country_code: countryCode,
    });
  } catch (err) {
    console.error("Failed to record device IP history (non-fatal):", err);
  }
}

/**
 * Upserts a device record for the user. Runs as service_role because
 * `devices` has no client INSERT policy (DB-002: "fingerprints are recorded
 * server-side at login"). Returns the row's id (to link
 * user_sessions.device_id, migration 0072) and whether this fingerprint was
 * genuinely new for this user.
 *
 * A first-seen fingerprint is logged as NewDeviceLogin via the existing
 * audit_logs path (Phase 3 Architecture Rev. 2, §8) -- deliberately not a
 * fraud_flags entry: a new device alone isn't inherently suspicious (most
 * are just someone's new phone) and would flood the moderator review queue
 * with noise. The logging call is fire-and-isolate -- a failure here must
 * never fail the login itself.
 */
export async function recordDevice(
  userId: string,
  fingerprint: string,
  platform: string | null,
  userAgent: string | null,
  ipAddress: string | null = null,
  countryCode: string | null = null,
): Promise<RecordDeviceResult> {
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
      .update({
        last_seen_at: new Date().toISOString(),
        ...(ipAddress ? { last_ip_address: ipAddress } : {}),
        ...(countryCode ? { country_code: countryCode } : {}),
      })
      .eq("id", existing.id);
    await recordDeviceIpHistory(existing.id, ipAddress, countryCode);
    return { deviceId: existing.id, isNewDevice: false };
  }

  const { data: inserted, error: insertError } = await supabase
    .from("devices")
    .insert({
      user_id: userId,
      device_fingerprint: fingerprint,
      platform,
      user_agent: userAgent,
      last_ip_address: ipAddress,
      country_code: countryCode,
    })
    .select("id")
    .single();

  if (insertError || !inserted) {
    console.error("Failed to record new device:", insertError);
    return { deviceId: null, isNewDevice: true };
  }

  await recordDeviceIpHistory(inserted.id, ipAddress, countryCode);

  try {
    await supabase.rpc("fn_write_audit_log", {
      p_actor_id: userId,
      p_actor_type: "user",
      p_action: "NewDeviceLogin",
      p_category: "auth",
      p_target_table: "devices",
      p_target_id: inserted.id,
      p_metadata: {},
    });
  } catch (err) {
    console.error("Failed to log NewDeviceLogin (non-fatal):", err);
  }

  // Phase 3C, Milestone 5: "device change" notification, extending this
  // phase's own NewDeviceLogin audit hook rather than introducing a
  // second, parallel detection mechanism. notifySecurityEvent has its own
  // internal fire-and-isolate handling.
  await notifySecurityEvent(userId, "DeviceChange", { device_id: inserted.id });

  return { deviceId: inserted.id, isNewDevice: true };
}

export interface DeviceListItem {
  id: string;
  device_fingerprint: string;
  platform: string | null;
  user_agent: string | null;
  first_seen_at: string;
  last_seen_at: string;
}

/**
 * Lists the caller's own devices, most-recently-active first. Takes the
 * caller's own RLS-respecting client, not service-role -- 0018's
 * devices_select_self_or_staff policy already scopes this to the caller's
 * own rows at the database layer, which is a requirement here, not a
 * preference (Phase 3 Architecture Rev. 2, §11): a forgotten filter still
 * can't leak another user's devices.
 */
export async function listDevicesForUser(
  supabase: SupabaseClient<Database>,
): Promise<{ data: DeviceListItem[]; error: Error | null }> {
  const { data, error } = await supabase
    .from("devices")
    .select("id, device_fingerprint, platform, user_agent, first_seen_at, last_seen_at")
    .order("last_seen_at", { ascending: false });

  return { data: data ?? [], error };
}
