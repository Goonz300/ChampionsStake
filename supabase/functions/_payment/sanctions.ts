// supabase/functions/_payment/sanctions.ts
//
// Phase 6: sanctions/PEP screening, confirmed missing before this fix (see
// migration 0084's header for why this is a real, administrator-maintained
// blocklist rather than a stub for an unavailable external provider).

import { getServiceRoleClient } from "../_shared/database/client.ts";
import { recordAudit } from "../_shared/audit/index.ts";

/** Lowercased, whitespace-collapsed, trimmed -- exact-match screening, not
 * fuzzy matching (a false negative here is a real risk, but so is a false
 * positive blocking a legitimate payout on a coincidental fuzzy match with
 * no provider data to disambiguate). */
export function normalizeName(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, " ");
}

export interface SanctionsCheckResult {
  blocked: boolean;
  reason?: string;
}

export async function checkSanctionsBlocklist(
  fullName: string,
): Promise<SanctionsCheckResult> {
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase
    .from("sanctions_blocklist")
    .select("reason")
    .eq("full_name_normalized", normalizeName(fullName))
    .maybeSingle();

  if (error) {
    // Fail open, same rationale as every other check in this codebase that
    // guards a control against its own infrastructure failing: a broken
    // blocklist query must not itself block every withdrawal/payout method
    // creation platform-wide.
    console.error("Sanctions blocklist check failed, allowing through:", error);
    return { blocked: false };
  }

  return data ? { blocked: true, reason: data.reason } : { blocked: false };
}

/** Throws if the name is blocklisted, auditing the block either way it
 * matters (a hit is always audited; a clean check is not, to avoid
 * flooding audit_logs with routine non-events). */
export async function assertNotSanctioned(
  fullName: string,
  userId: string,
  context: "payout_method_creation" | "withdrawal",
): Promise<void> {
  const result = await checkSanctionsBlocklist(fullName);
  if (!result.blocked) return;

  await recordAudit({
    actorId: userId,
    actorType: "user",
    action: "SanctionsScreeningBlocked",
    category: "financial",
    targetTable: "profiles",
    targetId: userId,
    metadata: { context, reason: result.reason },
  });

  throw new Error(
    "This request could not be processed. Please contact support.",
  );
}

export async function addToSanctionsBlocklist(
  fullName: string,
  reason: string,
  adminId: string,
): Promise<{ id: string }> {
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase
    .from("sanctions_blocklist")
    .insert({
      full_name_normalized: normalizeName(fullName),
      reason,
      added_by: adminId,
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`Failed to add to sanctions blocklist: ${error?.message}`);
  }

  await recordAudit({
    actorId: adminId,
    actorType: "administrator",
    action: "SanctionsBlocklistEntryAdded",
    category: "financial",
    targetTable: "sanctions_blocklist",
    targetId: data.id,
    metadata: { reason },
  });

  return { id: data.id };
}

export async function removeFromSanctionsBlocklist(
  id: string,
  adminId: string,
): Promise<void> {
  const supabase = getServiceRoleClient();
  await supabase.from("sanctions_blocklist").delete().eq("id", id);

  await recordAudit({
    actorId: adminId,
    actorType: "administrator",
    action: "SanctionsBlocklistEntryRemoved",
    category: "financial",
    targetTable: "sanctions_blocklist",
    targetId: id,
  });
}

export async function listSanctionsBlocklist(limit = 100) {
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase
    .from("sanctions_blocklist")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    throw new Error(`Failed to list sanctions blocklist: ${error.message}`);
  }
  return data ?? [];
}
