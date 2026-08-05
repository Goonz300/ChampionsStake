// supabase/functions/_admin/audit.ts

import { getServiceRoleClient } from "../_shared/database/client.ts";

export interface AuditSearchFilter {
  actorId?: string;
  targetTable?: string;
  targetId?: string;
  action?: string;
  category?: string;
  from?: string;
  to?: string;
  limit: number;
  cursor?: string;
}

export async function searchAuditLogs(filter: AuditSearchFilter) {
  const supabase = getServiceRoleClient();
  let query = supabase.from("audit_logs").select("*").order("created_at", {
    ascending: false,
  }).limit(filter.limit);

  if (filter.actorId) query = query.eq("actor_id", filter.actorId);
  if (filter.targetTable) query = query.eq("target_table", filter.targetTable);
  if (filter.targetId) query = query.eq("target_id", filter.targetId);
  if (filter.action) query = query.eq("action", filter.action);
  if (filter.category) query = query.eq("category", filter.category);
  if (filter.from) query = query.gte("created_at", filter.from);
  if (filter.to) query = query.lte("created_at", filter.to);
  if (filter.cursor) query = query.lt("created_at", filter.cursor);

  const { data, error } = await query;
  if (error) throw new Error(`Failed to search audit logs: ${error.message}`);
  return data ?? [];
}
