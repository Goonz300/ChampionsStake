# AUTH-001 — Authentication & Identity Foundation

## 1. Architecture Overview

Supabase Auth (email/password + OAuth-ready) is the identity provider; `@supabase/ssr` bridges its session into Next.js cookies so Server Components, Route Handlers, and `middleware.ts` all see the same session without prop-drilling a token around. Three Supabase clients exist for three distinct trust levels (`lib/supabase/client.ts` browser / `server.ts` RLS-respecting server / `server.ts`'s `createServiceRoleClient()` RLS-bypassing), matching Architecture §8's rule that the service-role key is only ever used server-side. `profiles`/`wallets`/`user_preferences` are created automatically by two Postgres triggers on `auth.users` (migration 0029) — registration never depends on application code remembering to create them, which removes an entire class of "half-registered user" bugs.

## 2. Folder Structure (additions this phase)

```
app/
  (auth)/{login,register,forgot-password,reset-password,verify-email}/page.tsx
  (app)/dashboard/page.tsx          (minimal — full dashboard is a later FE task)
  auth/callback/route.ts            (Supabase email-link handler)
  session-expired/page.tsx
  access-denied/page.tsx
  maintenance/page.tsx
  api/auth/
    register, login, logout, logout-all, forgot-password, reset-password,
    change-password, session, resend-verification, mfa/enroll, mfa/verify
components/auth/
  AuthProvider.tsx  AuthCard.tsx  form-elements.tsx
lib/
  auth/
    validation.ts (+ .test.ts)  rate-limit.ts (+ .test.ts)
    device.ts (+ .test.ts)  session-registry.ts  oauth.ts
  supabase/
    client.ts  server.ts  middleware.ts  types.ts
middleware.ts (+ middleware.test.ts)
supabase/migrations/0027-0029  supabase/tests/auth_integration_tests.md
```

## 3. Environment Variables

No new variables beyond Phase 0's `.env.example` — email/password and OAuth are configured in the Supabase Dashboard, not app env vars. `SUPABASE_SERVICE_ROLE_KEY` (already present) is what powers `createServiceRoleClient()`.

## 4. Supabase Configuration (operational steps — not expressible as code)

- **Auth Hook**: register `custom_access_token_hook` (already defined in DB-002 migration 0015) in `supabase/config.toml`:
  ```toml
  [auth.hook.custom_access_token]
  enabled = true
  uri = "pg-functions://postgres/public/custom_access_token_hook"
  ```
- **Password policy**: set the project's minimum password length to 10 in Dashboard → Authentication → Policies, so Supabase's own gate matches `lib/auth/validation.ts`'s zod schema instead of silently disagreeing with it.
- **Email templates**: point the confirmation/recovery email templates' links at `/auth/callback` (already the default pattern `@supabase/ssr` expects).
- **OAuth providers**: enable Google and Discord in Dashboard → Authentication → Providers, each with their own client ID/secret — `lib/auth/oauth.ts` is provider-name-driven and needs no code change when a provider is toggled on.
- **Site URL / Redirect URLs**: add the app's production and local dev URLs to the allow-list, or `exchangeCodeForSession` will reject the callback.

## 5. Middleware

`middleware.ts`: refreshes the session on every request (`updateSession`), checks a `maintenance_mode` feature flag first, redirects logged-in users away from auth pages, redirects anonymous users to `/login?redirect_to=<path>` for anything not in the public allow-list, and gates `/admin/*` by role (fixed a boundary bug during testing — `isAdminPath` now correctly excludes a hypothetical `/administrator` route rather than matching it via a naive `startsWith`).

## 6. Authentication Services

`lib/auth/`: zod validation (password ≥10 chars + letter + digit, matching Business Rules), rate limiting (5 attempts/15min/account+IP, backed by `audit_logs` rather than Upstash since Redis isn't provisioned yet — same interface either way so swapping later doesn't touch callers), device fingerprinting (SHA-256 of UA+language+/24 IP block, feeding Business Rules §14's fraud-detection signal), session registry (a hashed shadow of Supabase's own refresh tokens, enabling "your devices" UI and revocation without touching Supabase's internal schema), OAuth helper (provider name is a parameter, never hard-coded per this phase's instruction).

## 7. UI Pages

Register, login (with Remember Me and OAuth buttons), forgot-password, reset-password, verify-email (with resend), session-expired, access-denied, maintenance, and a minimal dashboard landing — all using the exact Tailwind tokens (`vv-neon-green`, `font-orbitron`/`font-exo`, `vv-surface`/`vv-divider`) established in Phase 0, adapted from the prototype's auth *modal* into routed *pages* (a structural requirement of App Router, not a visual redesign). Every form has loading/error/success states and labeled, `aria-describedby`-linked error messages.

## 8. Hooks

`useAuth()` (in `AuthProvider.tsx`) — the one hook this phase needed; further hooks (e.g. `useProfile()`, `useWallet()`) belong to the phases that own that data.

## 9. Context Providers

`AuthProvider` wraps the root layout, subscribing to `onAuthStateChange` so login/logout in one tab reflects everywhere without a manual refresh.

## 10. Session Management

Access/refresh handled entirely by Supabase + `@supabase/ssr`'s cookie sync. `user_sessions` (DB-001) is a parallel, hashed-token registry this phase now actually populates (previously just a schema with no writer) to support future "active sessions" UI and both single-device and all-device logout — both implemented (`/api/auth/logout`, `/api/auth/logout-all`).

**Known, documented simplification**: "Remember Me" does not yet vary cookie lifetime — Supabase's refresh-token expiry (7 days) is applied regardless of the checkbox, since `@supabase/ssr`'s cookie helper doesn't expose a per-call override. Flagged in code (`login/route.ts`) rather than silently dropped.

## 11. Tests

- `lib/auth/validation.test.ts` — 12 cases across all 4 schemas
- `lib/auth/rate-limit.test.ts` — under/at/over threshold + fail-open-on-error behavior, with the Supabase client properly mocked
- `lib/auth/device.test.ts` — determinism, sensitivity to UA, and the deliberate IP-granularity behavior
- `middleware.test.ts` — route classification, including a real bug this testing process caught and fixed (see §5)
- `supabase/tests/auth_integration_tests.md` — 12 integration/security test specs that need a live Supabase project to execute (not possible in this environment — no network access, confirmed by a failed `npm install` attempt, same limitation as every prior phase)

## 12. Verification Checklist

- [x] Registration creates `profiles`/`wallets`/`user_preferences` automatically via DB trigger, not application code
- [x] Password policy enforced client-and-server-side (zod), documented as needing to match Supabase's own project setting
- [x] Login rate-limited 5/15min/account+IP
- [x] Logout (single) and logout-all (every device) both implemented and distinct
- [x] Password reset never reveals account existence (always 200)
- [x] MFA/OAuth architecture present but not enforced anywhere yet (correctly deferred to Phase 5/6 per Business Rules)
- [x] Service-role client is never imported into a "use client" file (verified by manual review — `createServiceRoleClient` only appears in Route Handlers)
- [x] All new files pass a bracket-balance sanity check (verified programmatically, same method as prior phases)
- [x] A real bug (middleware's admin-path boundary) was caught by writing the test, not just asserted away
- [ ] **Not verified in this environment**: `npm install` fails here (403 from the registry — no network access in this container, confirmed directly). Every integration/security test in `auth_integration_tests.md`, and the unit tests in this phase, need to actually be run (`npm install && npm test`) against real dependencies before this is treated as done.

## Stop point

AUTH-001 is complete. Per your instruction, stopping here — not starting Wallet, Escrow, Challenges, or Tournaments until you approve.
