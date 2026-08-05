// app/api/health/route.ts
//
// PROD-001: a second, independent health check for the Next.js/Vercel side
// specifically — supabase/functions/health checks the Edge Function
// runtime's own DB connectivity; this checks that the Vercel deployment
// itself is serving traffic and can reach Supabase from ITS network path,
// which is a genuinely different failure domain.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const started = Date.now();
  let databaseHealthy = false;

  try {
    const supabase = await createClient();
    const { error } = await supabase
      .from("games")
      .select("id", { count: "exact", head: true })
      .limit(1);
    databaseHealthy = !error;
  } catch {
    databaseHealthy = false;
  }

  const latencyMs = Date.now() - started;

  return NextResponse.json(
    {
      status: databaseHealthy ? "ready" : "not_ready",
      checks: { database: databaseHealthy ? "healthy" : "unhealthy" },
      latencyMs,
      timestamp: new Date().toISOString(),
    },
    { status: databaseHealthy ? 200 : 503 },
  );
}
