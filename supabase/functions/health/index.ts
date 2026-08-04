// supabase/functions/health/index.ts
//
// PROD-001 finding: no health/readiness/liveness endpoint existed anywhere
// in the platform before this file. admin-system-health (ADMIN-001) is
// NOT a substitute — it requires administrator auth, which external uptime
// monitors (Vercel, UptimeRobot, Supabase's own health checks, a future
// load balancer) cannot and should not authenticate as. This is a genuine,
// concrete production-readiness gap, fixed here rather than just reported.
//
// Deliberately outside the withEdgeFunction wrapper (no JWT handling, no
// rate limiting) — a health check must respond even if auth infrastructure
// itself is degraded, and must be as fast and dependency-light as possible.

import { getServiceRoleClient } from "../_shared/database/client.ts";

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);

  if (url.pathname.endsWith("/live")) {
    return new Response(JSON.stringify({ status: "alive" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const started = Date.now();
  let databaseHealthy = false;

  try {
    const supabase = getServiceRoleClient();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const { error } = await supabase.from("games").select("id", { count: "exact", head: true }).abortSignal(controller.signal);
    clearTimeout(timeout);
    databaseHealthy = !error;
  } catch {
    databaseHealthy = false;
  }

  const latencyMs = Date.now() - started;
  const healthy = databaseHealthy;

  return new Response(
    JSON.stringify({
      status: healthy ? "ready" : "not_ready",
      checks: { database: databaseHealthy ? "healthy" : "unhealthy" },
      latencyMs,
      timestamp: new Date().toISOString(),
    }),
    {
      status: healthy ? 200 : 503,
      headers: { "Content-Type": "application/json" },
    },
  );
});
