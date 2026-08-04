// supabase/functions/_shared/security/headers.ts

export const securityHeaders: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Cache-Control": "no-store",
  // CORS is intentionally NOT set to a wildcard here — see origin.ts, which
  // computes the correct Access-Control-Allow-Origin per-request against
  // config.security.allowedOrigins rather than a blanket "*".
};
