// supabase/functions/_shared/security/client-ip.ts
//
// Single source of truth for extracting the real client IP from an incoming
// request. Before this module existed, two independent, slightly different
// implementations of this same ~5-line logic existed (audit/index.ts's
// extractRequestContext and the web app's own getClientIp in
// apps/web/app/api/auth/login/route.ts) — both trusted the FIRST entry of
// X-Forwarded-For, which is the client's own self-reported value and is
// trivially spoofable by any caller who can reach the origin directly.
//
// Layer 1 (Edge Protection) assumes deployment behind Cloudflare or an
// equivalent CDN/WAF: CF-Connecting-IP is set by Cloudflare itself on every
// request that passes through its edge, overwriting any client-supplied
// value, so it is preferred whenever present. Falling back to
// X-Forwarded-For, the Nth-from-the-END entry (not the first) is trusted,
// where N is config.security.trustedProxyHops — each trusted hop APPENDS to
// the end of the header, so counting from the end skips exactly the hops we
// don't control instead of trusting whatever the original caller claimed.

import { config } from "../config/index.ts";

function trustedIpFromForwardedFor(
  value: string,
  trustedHops: number,
): string | null {
  const ips = value.split(",").map((s) => s.trim()).filter(Boolean);
  if (ips.length === 0) return null;

  const index = ips.length - trustedHops;
  if (index >= 0 && index < ips.length) return ips[index] ?? ips[0] ?? null;

  // Fewer hops present than configured (e.g. local dev with no CDN in
  // front) — best-effort fall back to the first entry rather than null.
  return ips[0] ?? null;
}

/** Extracts the real client IP, or null if no usable header is present. */
export function getClientIp(request: Request): string | null {
  const cfConnectingIp = request.headers.get("cf-connecting-ip")?.trim();
  if (cfConnectingIp) return cfConnectingIp;

  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const ip = trustedIpFromForwardedFor(
      forwardedFor,
      config.security.trustedProxyHops,
    );
    if (ip) return ip;
  }

  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;

  return null;
}
