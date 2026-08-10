import type { NextConfig } from "next";

/**
 * ChampionsStake Next.js configuration.
 *
 * Notes:
 * - `reactStrictMode` is enabled to surface unsafe lifecycle/effect usage early,
 *   which matters here because escrow/wallet UI state must never double-fire
 *   a mutating request (see Business Rules §7 concurrency rule).
 * - `images.remotePatterns` is scoped to Supabase Storage only; no other
 *   external image host is permitted (avatars/chat-media/proofs buckets).
 * - `typedRoutes` is enabled so route typos are caught at build time rather
 *   than at runtime, which matters for the many participant-only routes
 *   (e.g. /challenge/[id]) that must not silently 404 in production.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  typescript: {
    ignoreBuildErrors: false,
  },
  eslint: {
    ignoreDuringBuilds: false,
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },
  experimental: {
    typedRoutes: true,
  },
  async headers() {
    // Phase 8.5 hostile-review fix: this app previously shipped with zero
    // security headers at all -- no CSP, no X-Frame-Options, no HSTS. A
    // fresh hostile review found no CURRENT XSS sink (React's default
    // escaping, zero dangerouslySetInnerHTML/innerHTML usage across the
    // whole app), so this closes a real defense-in-depth gap rather than
    // an active exploit.
    //
    // CSP note: script-src keeps 'unsafe-inline' deliberately. Next.js's
    // App Router injects a small inline hydration script on every page;
    // removing 'unsafe-inline' requires a nonce-based CSP wired through
    // middleware, which changes runtime behavior in a way that can only be
    // verified by loading real pages in a real browser -- unavailable in
    // this environment (no live deployment exists to test against). Every
    // OTHER directive here (frame-ancestors, object-src, base-uri,
    // form-action, connect-src/img-src scoped to self + Supabase) is real,
    // verified hardening with no such runtime dependency: it still blocks
    // clickjacking, plugin/object-based attacks, base-tag hijacking, and
    // exfiltration to an arbitrary origin even if a future XSS vector is
    // ever introduced. See docs/PHASE8_5_SECURITY_GUIDE.md for the
    // nonce-based CSP as a documented next step.
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' https://*.supabase.co data:",
      "font-src 'self'",
      "connect-src 'self' https://*.supabase.co",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; ");

    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
