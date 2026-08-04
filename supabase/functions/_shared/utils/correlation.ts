// supabase/functions/_shared/utils/correlation.ts

/**
 * Extracts an incoming correlation ID (propagated from an upstream caller,
 * e.g. the Next.js app forwarding a trace id) or generates a fresh one.
 * Every log line and audit entry for a request should carry the same
 * correlation ID so a single user action can be traced across the Next.js
 * app, this Edge Function, and any Postgres triggers it fires.
 */
export function getOrCreateCorrelationId(request: Request): string {
  return request.headers.get("X-Correlation-Id") ?? crypto.randomUUID();
}

export function generateRequestId(): string {
  return crypto.randomUUID();
}
