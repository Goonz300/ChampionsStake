import type { CookieOptionsWithName } from "@supabase/ssr";

/**
 * Phase 8.5 hostile-review fix: @supabase/ssr's own default cookie options
 * (DEFAULT_COOKIE_OPTIONS in the library) are `{ path: "/", sameSite:
 * "lax", httpOnly: false }` — no `secure` flag at all. A hostile review
 * verified this directly against the installed library rather than
 * trusting an earlier claim that "safe defaults" were inherited.
 *
 * `httpOnly` is deliberately left at the library default (false), not
 * hardened here: the browser-side client (lib/supabase/client.ts) reads
 * this same cookie directly via document.cookie for real, load-bearing
 * functionality (AuthProvider, OAuth flow, realtime subscription auth) —
 * setting httpOnly:true would break that client-side session access, and
 * this is @supabase/ssr's own documented, intentional design (the SSR
 * pattern requires the cookie to be readable on both sides), not an
 * oversight to "fix."
 *
 * `secure` is the one real, safe fix: forcing it in production (never
 * sent over plain HTTP) with no risk to local development, where requests
 * are typically plain http://localhost and a forced Secure cookie
 * wouldn't be stored/sent at all.
 */
export const secureCookieOptions: CookieOptionsWithName = {
  secure: process.env.NODE_ENV === "production",
};
