# Phase 8.5 — Independent Hostile Security Review

A fresh hostile review, deliberately scoped to areas Phase 7/8's own dedicated review (`docs/PHASE7_8_SECURITY_REVIEW.md`) and Phase 1-6's security work (`docs/THREAT_MODEL.md`, `docs/ATTACK_MATRIX.md`, `docs/SECURITY_ARCHITECTURE.md`) hadn't already covered — no finding below duplicates those reviews' work; several explicitly re-verify a prior review's claim directly against the code rather than trusting it.

## Findings and resolutions

### HIGH — Moderator dispute-assignment authorization is broken (confirmed, exploitable)

**Defect**: `_moderator/cases.ts`'s `assertModeratorOnDispute` had an inverted condition — it `return`ed (allowed access) in exactly the branch meant to deny it (dispute assigned to a *different* moderator), and never threw under any input. `_moderator/decisions.ts` (every mutating dispute action: approve winner/opponent, void match, reopen, request evidence, return to players) and `_moderator/notes.ts` never called any assignment check at all. `_moderator/queue.ts`'s `claimDispute`/`assignDispute` clearly intend single-owner review semantics (an explicit `"already assigned to another moderator"` conflict error) — nothing downstream enforced it.

**Attack**: dispute D is claimed by moderator A and mid-review. Moderator B (any other active moderator account) calls `moderator-decision {action:"approve_opponent", disputeId:D, ...}`. It succeeds — escrow releases per B's decision, silently overriding whoever was already reviewing the case and defeating any recusal/conflict-of-interest routing the assignment system exists for.

**Impact**: direct control over real-money escrow release direction by an unintended moderator.

**Fix**: extracted the pure decision logic into `_moderator/authorization-heuristics.ts`'s `isModeratorAllowedOnDispute` (unit-tested, 4 cases pinning the exact inverted-condition bug so it can't regress silently), fixed `assertModeratorOnDispute` to actually throw, and wired the check into every mutating function in `decisions.ts` and both functions in `notes.ts` (plus `cases.ts`'s previously-unchecked `getEvidenceList`). Every Edge Function caller (`moderator-decision`, `moderator-note`, `moderator-dashboard`) now threads `isAdmin` through so administrators retain their existing bypass.

### MEDIUM — Zero security headers / no CSP (real gap, no active exploit found)

**Defect**: `next.config.ts` had no `headers()` config at all — no CSP, HSTS, X-Frame-Options, or X-Content-Type-Options anywhere. A dedicated XSS-sink search (`dangerouslySetInnerHTML`, `innerHTML`, `document.write`, `eval`) found zero hits — React's default escaping meant there was no active exploit today, but the complete absence of headers is a real defense-in-depth gap that would matter the moment any future XSS vector or compromised third-party script appears.

**Fix**: added `headers()` to `next.config.ts` — CSP (`frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `connect-src`/`img-src` scoped to self + Supabase), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Strict-Transport-Security`, `Referrer-Policy`, `Permissions-Policy`. `script-src`/`style-src` deliberately keep `'unsafe-inline'` — Next.js's App Router injects a small inline hydration script on every page, and removing `'unsafe-inline'` requires a nonce-based CSP wired through middleware, whose correctness can only be verified by loading real pages in a real browser (unavailable in this environment). Documented as the concrete next step in `PHASE8_5_SECURITY_GUIDE.md` rather than attempted blind.

### MEDIUM — Auth cookies missing the `Secure` flag (verified directly, not trusted from a prior claim)

**Defect**: a prior audit claimed cookie handling "inherits `@supabase/ssr`'s secure defaults." This review checked that claim against the installed library directly rather than accepting it: `@supabase/ssr@0.5.2`'s actual `DEFAULT_COOKIE_OPTIONS` is `{ path: "/", sameSite: "lax", httpOnly: false }` — **no `secure` flag**, and no call site in the app overrode it.

**Fix**: added `apps/web/lib/supabase/cookie-options.ts` exporting `secureCookieOptions` (`secure: true` in production only — forcing it unconditionally would break local dev, which typically runs over plain `http://localhost`), wired into all three real cookie-managing client constructors (`lib/supabase/client.ts`, `lib/supabase/server.ts`'s `createClient`, `lib/supabase/middleware.ts`). `httpOnly` was deliberately **left** at the library default: the browser-side client (`lib/supabase/client.ts`) reads this same cookie directly via `document.cookie` for real, load-bearing functionality (`AuthProvider`, OAuth flow, realtime subscription auth, confirmed by checking actual import sites) — this is `@supabase/ssr`'s own intentional SSR design, not an oversight, and forcing `httpOnly: true` would break client-side session access in a way this environment has no live browser to verify against.

### MEDIUM — Public bucket allowed an unsanitized SVG upload (confirmed, admin-scoped)

**Defect**: the `system-assets` storage bucket (public, admin-write-only) allowed `image/svg+xml`, but no magic-byte signature or content sanitization exists for SVG anywhere in the codebase (`image-processing.ts`'s threat scanner is an honestly-documented no-op). An SVG containing `<script>` executes if a browser navigates to it directly on the public, trusted-looking `*.supabase.co` URL.

**Impact**: scoped to an already-compromised or malicious admin account — not exploitable by a regular user — but a real, concrete stored-script-hosting vector usable for phishing/persistence, not theoretical.

**Fix**: removed `image/svg+xml` from `system-assets`'s allowlist at both the application level (`lib/storage/config.ts`) and the Supabase Storage level (migration `0107`, additive, paired rollback). Admin-owned logo/icon assets remain uploadable as PNG/WEBP, both of which have real magic-byte validation. Regression test added confirming SVG is now rejected as a disallowed MIME type for this bucket.

## Findings investigated and confirmed clean (no fix needed)

- **CSRF**: every `apps/web/app/api/**/route.ts` mutation uses POST/PATCH/DELETE (zero GET-based state changes, verified across all 34 route files); `SameSite=Lax` cookies block cross-site form POSTs; Edge Function CORS never sets `Access-Control-Allow-Credentials`.
- **SSRF**: every outbound `fetch()` in `supabase/functions` targets a hardcoded constant (Paystack, Resend, Expo, TOR/cloud IP-range sources) — no user-supplied URL ever reaches a server-side outbound request.
- **Webhook verification**: `payment-webhook` verifies the HMAC-SHA512 signature (constant-time comparison) *before* any DB write; idempotency is enforced by a unique-constraint insert, so a replayed valid payload hits a `23505` and returns `"duplicate"` without re-executing.
- **SQL injection**: `_wallet/ledger.ts`'s `sql\`...\`` usage is a genuine parameterized tagged template (verified, not string concatenation); zero `sql.unsafe`/`.raw(` usage anywhere. A handful of PostgREST `.or()` filter-string interpolations exist, but every interpolated value traced to a server-derived, JWT-verified UUID, never raw client input.
- **Sensitive data in logs**: no token/password/secret/card/account-number key found logged anywhere across `_wallet/`, `_payment/`, `_admin/`.
- **Timing attacks**: `timingSafeEqual` is used consistently across all 21 scheduled-job shared-secret checks plus the webhook HMAC check — no naive `===` secret comparison found anywhere.
- **Supply chain**: all dependencies are version-pinned from the standard npm/jsr registries; no git/http dependency sources; both lockfiles present.
- **Admin/Moderator entry-point gating** (distinct from the assignment-scoping bug above): all 8 `admin-*` and 6 `moderator-*` Edge Functions correctly call `requireAdministrator`/`requireModerator` against a server-loaded, DB-sourced profile — no bypass route found.

## Full validation

Every fix passed the complete pipeline (`deno fmt --check`, `deno lint`, `deno check` across all 219 files, `deno test` — 212 passed; `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm run test` — 194 passed, `npm run build`) before commit.
