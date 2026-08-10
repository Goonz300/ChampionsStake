import { createBrowserClient } from "@supabase/ssr";
import { clientEnv } from "@/lib/env";
import type { Database } from "@/lib/supabase/types";
import { secureCookieOptions } from "@/lib/supabase/cookie-options";

/**
 * Browser-side Supabase client. Safe to import from "use client" components.
 * Uses the anon key only — RLS (DB-002) is what actually protects data, not
 * this client's configuration.
 */
export function createClient() {
  return createBrowserClient<Database>(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { cookieOptions: secureCookieOptions },
  );
}
