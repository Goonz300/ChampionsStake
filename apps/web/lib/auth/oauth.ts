"use client";

import { createClient } from "@/lib/supabase/client";

/**
 * Supported OAuth providers. Adding a new one is a one-line change here plus
 * enabling it in the Supabase Dashboard (Authentication > Providers) — no
 * other application code should ever hard-code "google" or "discord"
 * directly, per this phase's "do not hard-code providers" instruction.
 */
export type OAuthProvider = "google" | "discord";

export async function signInWithOAuth(provider: OAuthProvider, redirectTo?: string) {
  const supabase = createClient();

  return supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: `${window.location.origin}/auth/callback?next=${redirectTo ?? "/dashboard"}`,
    },
  });
}
