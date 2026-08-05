// supabase/functions/_shared/security/origin.ts

import { config } from "../config/index.ts";
import { AuthorizationError } from "../errors/index.ts";

/**
 * Computes CORS headers for a request, or throws if the origin isn't on the
 * allow-list. Webhook endpoints (Stripe, KYC provider) should NOT use this —
 * they're server-to-server calls with no Origin header and are secured by
 * signature verification instead (see signed-requests.ts).
 */
export function corsHeadersFor(request: Request): Record<string, string> {
  const origin = request.headers.get("Origin");

  if (!origin) {
    // No Origin header at all — a server-to-server or same-origin request.
    // Not itself a rejection; the caller decides whether that's acceptable
    // for a given endpoint.
    return {};
  }

  if (config.security.allowedOrigins.length === 0) {
    // No allow-list configured (e.g. local dev) — permissive, but logged so
    // it's visible this isn't a production-safe default.
    console.warn(
      "EDGE_ALLOWED_ORIGINS is not configured; allowing all origins.",
    );
    return { "Access-Control-Allow-Origin": origin, Vary: "Origin" };
  }

  if (!config.security.allowedOrigins.includes(origin)) {
    throw new AuthorizationError(`Origin "${origin}" is not permitted.`);
  }

  return { "Access-Control-Allow-Origin": origin, Vary: "Origin" };
}

export function handlePreflight(request: Request): Response | null {
  if (request.method !== "OPTIONS") return null;

  return new Response(null, {
    status: 204,
    headers: {
      ...corsHeadersFor(request),
      "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers":
        "authorization, content-type, idempotency-key, x-correlation-id",
      "Access-Control-Max-Age": "86400",
    },
  });
}
