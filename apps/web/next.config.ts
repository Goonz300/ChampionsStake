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
};

export default nextConfig;
