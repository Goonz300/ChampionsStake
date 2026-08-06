import { createServerClient } from "@supabase/ssr";
import { clientEnv } from "@/lib/env";
import type { Database } from "@/lib/supabase/types";

/**
 * Edge-runtime-safe counterpart to session-registry.ts's
 * isSessionMfaVerified, used ONLY by middleware.ts (via
 * lib/supabase/middleware.ts). Next.js middleware runs in the Edge
 * runtime, which cannot bundle node:crypto -- what session-registry.ts's
 * hashToken uses -- so this file duplicates just the one hash computation
 * it needs, using the Web Crypto API (crypto.subtle), which Edge, Node,
 * and browsers all support. Must hash identically to session-registry.ts's
 * hashToken (SHA-256, same lowercase-hex digest) since both compare
 * against the same user_sessions.refresh_token_hash column.
 *
 * Builds its own service-role client directly with createServerClient
 * (mirroring lib/supabase/middleware.ts's own existing pattern) rather
 * than importing lib/supabase/server.ts's createServiceRoleClient, for two
 * reasons: that module also exports createClient, which imports
 * next/headers's cookies() -- not valid in a middleware context -- and
 * reads SUPABASE_SERVICE_ROLE_KEY via lib/env.ts's serverEnv, which
 * eagerly validates every server secret (including RESEND_API_KEY) on
 * first access to any one of them. Middleware runs on every request, so
 * coupling this Edge-only, per-request check to an unrelated secret being
 * configured would be a needless new failure mode; reading the one env var
 * this file actually needs directly avoids it.
 */
function serviceRoleClientEdge() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!serviceRoleKey) {
    throw new Error("Missing required environment variable: SUPABASE_SERVICE_ROLE_KEY.");
  }

  return createServerClient<Database>(clientEnv.NEXT_PUBLIC_SUPABASE_URL, serviceRoleKey, {
    cookies: { getAll: () => [], setAll: () => {} },
  });
}

async function hashTokenEdge(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function isSessionMfaVerifiedEdge(refreshToken: string): Promise<boolean> {
  const supabase = serviceRoleClientEdge();
  const hash = await hashTokenEdge(refreshToken);

  const { data } = await supabase
    .from("user_sessions")
    .select("mfa_verified_at")
    .eq("refresh_token_hash", hash)
    .maybeSingle();

  return data?.mfa_verified_at != null;
}
