import { createClient as createBrowserSupabaseClient } from "@/lib/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

/**
 * Phase 4: a single shared browser Supabase client instance for every
 * realtime hook to reuse, rather than each hook (usePresence, useTyping,
 * useNotifications, useChallengeEvents, useTournamentEvents,
 * useWalletEvents) independently calling lib/supabase/client.ts's
 * createClient(). Not a new client implementation -- same function,
 * called once and memoized here -- but concentrating it in one module
 * avoids each hook accidentally opening its own separate Realtime
 * WebSocket connection, which is exactly the kind of "duplicate listener"
 * this phase's brief warns against.
 */
let cached: SupabaseClient<Database> | undefined;

export function getRealtimeClient(): SupabaseClient<Database> {
  if (!cached) {
    cached = createBrowserSupabaseClient();
  }
  return cached;
}
