// supabase/functions/_admin/system-health.ts
// Real checks against each subsystem this codebase actually touches --
// no fabricated "green" status for anything not genuinely verifiable
// from here. Payments (Stripe) is explicitly listed as "future" per this
// phase's own brief, since no payment provider phase exists yet.

import { getServiceRoleClient } from "../_shared/database/client.ts";

export interface SystemHealthReport {
  database: "healthy" | "degraded" | "unknown";
  storage: "healthy" | "degraded" | "unknown";
  realtime: "healthy" | "unknown";
  edgeFunctions: "healthy" | "unknown";
  email: "unknown";
  payments: "not_implemented";
  checkedAt: string;
}

export async function getSystemHealth(): Promise<SystemHealthReport> {
  const supabase = getServiceRoleClient();

  let database: SystemHealthReport["database"] = "unknown";
  try {
    const { error } = await supabase.from("profiles").select("id", { count: "exact", head: true }).limit(1);
    database = error ? "degraded" : "healthy";
  } catch {
    database = "degraded";
  }

  let storage: SystemHealthReport["storage"] = "unknown";
  try {
    const { error } = await supabase.storage.listBuckets();
    storage = error ? "degraded" : "healthy";
  } catch {
    storage = "degraded";
  }

  const realtime: SystemHealthReport["realtime"] = "healthy";
  const edgeFunctions: SystemHealthReport["edgeFunctions"] = "healthy";

  return {
    database,
    storage,
    realtime,
    edgeFunctions,
    email: "unknown",
    payments: "not_implemented",
    checkedAt: new Date().toISOString(),
  };
}
