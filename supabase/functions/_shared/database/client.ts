// supabase/functions/_shared/database/client.ts

import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { config } from "../config/index.ts";

let cachedServiceRoleClient: SupabaseClient | null = null;

/**
 * Service-role client — bypasses RLS entirely. This is the expected,
 * correct client for Edge Functions to use for their own writes (Edge
 * Functions ARE the trusted "system" actor per Architecture §8), but every
 * function using it is still responsible for its OWN authorization checks
 * (reusing the DB-002 helper functions via RPC, exactly as
 * lib/storage/service.ts does in the Next.js app) — bypassing RLS is not
 * the same thing as skipping authorization.
 */
export function getServiceRoleClient(): SupabaseClient {
  if (!cachedServiceRoleClient) {
    cachedServiceRoleClient = createClient(
      config.supabase.url,
      config.supabase.serviceRoleKey,
      {
        auth: { persistSession: false, autoRefreshToken: false },
      },
    );
  }
  return cachedServiceRoleClient;
}

/**
 * Builds a client scoped to the calling user's own JWT, so RLS applies
 * exactly as it would for that user. Use this (not the service-role client)
 * whenever a function's authorization model should just be "whatever this
 * user's own RLS policies already allow" — e.g. a read-only proxy endpoint.
 */
export function getUserScopedClient(userJwt: string): SupabaseClient {
  return createClient(config.supabase.url, config.supabase.anonKey, {
    global: { headers: { Authorization: `Bearer ${userJwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
