import { createServiceRoleClient } from "@/lib/supabase/server";

const DEFAULT_WINDOW_HOURS = 24;
const DEFAULT_MAX_ACCOUNTS_PER_DEVICE = 5;

/**
 * Layer 5/6: mass account creation / account farming detection. Runs after
 * a new registration's device fingerprint has been recorded (device.ts's
 * recordDevice) -- counts DISTINCT accounts that share this exact
 * fingerprint, and raises the existing 'multi_account' fraud_flags type
 * (migration 0060) if it exceeds the threshold. This is deliberately the
 * SAME flag_type _ai/fraud-detection.ts's checkMultiAccount already uses
 * for the (unrelated but conceptually identical) "two challenge
 * participants share a device" signal -- both describe the same underlying
 * fact (one device controls multiple accounts), just discovered at a
 * different moment, so they share a type and are distinguished via
 * details.signal instead of adding a parallel enum value.
 *
 * Flag only, never blocks registration -- matches this codebase's existing,
 * hard rule for fraud_flags (never auto-reject/auto-block without human
 * review).
 */
export async function checkDeviceFarming(
  newUserId: string,
  fingerprint: string,
  windowHours: number = DEFAULT_WINDOW_HOURS,
  maxAccountsPerDevice: number = DEFAULT_MAX_ACCOUNTS_PER_DEVICE,
): Promise<void> {
  const supabase = createServiceRoleClient();
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString();

  const { data: rows } = await supabase
    .from("devices")
    .select("user_id")
    .eq("device_fingerprint", fingerprint)
    .gte("first_seen_at", since);

  const distinctUserIds = new Set((rows ?? []).map((r) => r.user_id as string));
  if (distinctUserIds.size < maxAccountsPerDevice) return;

  const { data: existing } = await supabase
    .from("fraud_flags")
    .select("id")
    .eq("flag_type", "multi_account")
    .eq("primary_user_id", newUserId)
    .eq("status", "open")
    .contains("details", { signal: "mass_account_creation" })
    .maybeSingle();
  if (existing) return;

  await supabase.from("fraud_flags").insert({
    flag_type: "multi_account",
    primary_user_id: newUserId,
    score: Math.min(100, 50 + (distinctUserIds.size - maxAccountsPerDevice) * 10),
    details: {
      signal: "mass_account_creation",
      account_count: distinctUserIds.size,
      window_hours: windowHours,
    },
  });
}
