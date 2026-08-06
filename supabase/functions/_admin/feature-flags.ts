// supabase/functions/_admin/feature-flags.ts
//
// The four-eyes dual-approval workflow for requires_dual_approval=true
// flags is ALREADY enforced entirely by fn_feature_flags_dual_approval_guard
// (DB-002/this project's earliest security phase) directly on UPDATE -- a
// first admin's toggle records pending_approval_by without flipping
// `enabled`; a second, different admin's UPDATE actually flips it. This
// file does nothing but issue that UPDATE; it does not reimplement the
// approval logic, which would risk the two copies drifting apart.

import { getServiceRoleClient } from "../_shared/database/client.ts";
import { recordAudit } from "../_shared/audit/index.ts";

export async function listFeatureFlags() {
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase.from("feature_flags").select("*")
    .order("key", { ascending: true });
  if (error) throw new Error(`Failed to list feature flags: ${error.message}`);
  return data ?? [];
}

/**
 * Phase 3D independent-review finding: this write had no audit trail at
 * all, despite being a privileged action that can gate money-affecting
 * behavior. The four-eyes dual-approval workflow itself is untouched
 * (still entirely enforced by fn_feature_flags_dual_approval_guard on the
 * UPDATE below, per this file's original header comment) -- actorId is
 * added only to record WHO issued each toggle, not to change what the
 * toggle does.
 */
export async function toggleFeatureFlag(
  key: string,
  enabled: boolean,
  actorId: string,
) {
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase
    .from("feature_flags")
    .update({ enabled })
    .eq("key", key)
    .select("*")
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to update feature flag ${key}: ${error.message}`);
  }

  await recordAudit({
    actorId,
    actorType: "administrator",
    action: "FeatureFlagToggled",
    category: "admin",
    targetTable: "feature_flags",
    targetId: key,
    metadata: { requested_enabled: enabled },
  });

  return data;
}
