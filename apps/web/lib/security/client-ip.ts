import { serverEnv } from "@/lib/env";

/**
 * Single source of truth for extracting the real client IP in the Next.js
 * app. Mirrors supabase/functions/_shared/security/client-ip.ts's logic
 * exactly (the two runtimes can't share a module, but must not drift into
 * two different behaviors for the same header) — previously
 * app/api/auth/login/route.ts had its own inline copy that trusted the
 * FIRST X-Forwarded-For entry (client-supplied, spoofable) instead of the
 * entry appended by our own trusted proxy.
 *
 * CF-Connecting-IP (set by Cloudflare, overwriting any client value) is
 * preferred when present. Falling back to X-Forwarded-For, the
 * Nth-from-the-end entry is trusted, where N = TRUSTED_PROXY_HOPS.
 */
function trustedIpFromForwardedFor(value: string, trustedHops: number): string | null {
  const ips = value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (ips.length === 0) return null;

  const index = ips.length - trustedHops;
  if (index >= 0 && index < ips.length) return ips[index] ?? ips[0] ?? null;

  return ips[0] ?? null;
}

export function getClientIp(request: Request): string {
  const trustedHops = Number(serverEnv.TRUSTED_PROXY_HOPS ?? "1");

  const cfConnectingIp = request.headers.get("cf-connecting-ip")?.trim();
  if (cfConnectingIp) return cfConnectingIp;

  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const ip = trustedIpFromForwardedFor(forwardedFor, trustedHops);
    if (ip) return ip;
  }

  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;

  return "0.0.0.0";
}
