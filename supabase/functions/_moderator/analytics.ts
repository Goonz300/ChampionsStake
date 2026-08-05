// supabase/functions/_moderator/analytics.ts

import { getServiceRoleClient } from "../_shared/database/client.ts";

export async function moderatorAnalytics(days: number) {
  const supabase = getServiceRoleClient();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const { data: opened } = await supabase.from("disputes").select("id").gte(
    "created_at",
    since,
  );
  const { data: closed } = await supabase
    .from("disputes")
    .select("id, created_at, decided_at")
    .in("status", ["resolved", "closed"])
    .gte("decided_at", since);
  const { data: appealed } = await supabase
    .from("disputes")
    .select("id")
    .not("appeal_filed_at", "is", null)
    .gte("created_at", since);
  const { data: resolutions } = await supabase
    .from("disputes")
    .select("resolution")
    .gte("created_at", since)
    .not("resolution", "is", null);

  const resolutionTimes = (closed ?? [])
    .filter((d) => d.decided_at)
    .map((d) =>
      (new Date(d.decided_at as string).getTime() -
        new Date(d.created_at).getTime()) / (1000 * 60 * 60)
    );
  const avgResolutionHours = resolutionTimes.length > 0
    ? resolutionTimes.reduce((s, t) => s + t, 0) / resolutionTimes.length
    : null;

  const decisionDistribution: Record<string, number> = {};
  for (const row of resolutions ?? []) {
    const key = row.resolution as string;
    decisionDistribution[key] = (decisionDistribution[key] ?? 0) + 1;
  }

  const { data: workloadRows } = await supabase
    .from("disputes")
    .select("assigned_moderator_id")
    .in("status", ["open", "under_review"])
    .not("assigned_moderator_id", "is", null);
  const workload: Record<string, number> = {};
  for (const row of workloadRows ?? []) {
    const id = row.assigned_moderator_id as string;
    workload[id] = (workload[id] ?? 0) + 1;
  }

  return {
    casesOpened: (opened ?? []).length,
    casesClosed: (closed ?? []).length,
    averageResolutionHours: avgResolutionHours,
    appealRate: (opened ?? []).length > 0
      ? (appealed ?? []).length / (opened ?? []).length
      : 0,
    decisionDistribution,
    moderatorWorkload: workload,
  };
}
