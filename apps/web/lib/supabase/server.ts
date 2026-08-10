import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { clientEnv, serverEnv } from "@/lib/env";
import type { Database } from "@/lib/supabase/types";
import { secureCookieOptions } from "@/lib/supabase/cookie-options";

/**
 * Server-side Supabase client for use in Server Components, Route Handlers,
 * and Server Actions. Reads/writes the session via Next.js cookies.
 *
 * Uses the anon key (RLS-protected), NOT the service role key — this client
 * behaves exactly as an "authenticated" (or "anon") Postgres role would,
 * which is deliberate: almost everything the server needs to do on a user's
 * behalf should go through RLS, not around it. Reach for
 * `createServiceRoleClient()` (below) only for the small set of operations
 * that must run as `service_role` (e.g. logout-all-devices via the Auth
 * admin API), and justify each such use case inline where it's called.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component (not a Route Handler/Server
            // Action) — cookies can't be set here. Safe to ignore as long as
            // middleware.ts is refreshing the session on every request,
            // which it does (see middleware.ts).
          }
        },
      },
      cookieOptions: secureCookieOptions,
    },
  );
}

/**
 * Service-role Supabase client. Bypasses RLS entirely (Architecture §8: "the
 * service-role key only used inside Edge Functions/Route Handlers, never
 * shipped to a client"). Import this ONLY inside server-only files
 * (Route Handlers), and only for operations that genuinely require it —
 * e.g. Supabase's admin.signOut(userId, 'global') for logout-all-devices,
 * which has no RLS-respecting client-side equivalent.
 */
export function createServiceRoleClient() {
  return createServerClient<Database>(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    serverEnv.SUPABASE_SERVICE_ROLE_KEY,
    {
      cookies: {
        getAll() {
          return [];
        },
        setAll() {
          // Service-role client is never used to manage a browser session.
        },
      },
    },
  );
}
