# AUTH-001 Integration & Security Test Plan

The unit tests in `lib/auth/*.test.ts` and `middleware.test.ts` cover pure logic
(validation schemas, rate-limit math, fingerprint derivation, route
classification) and run with `npm test` — no live services required.

The tests below need a real Supabase project (local `supabase start` or a
staging project) plus `npm install` succeeding, neither of which was possible
in this environment (no network access — see AUTH-001-deliverable.md). They
are specified precisely enough to implement directly once that's available.

## Integration tests (Playwright, against a running `next dev` + local Supabase)

1. **Register → verify → login**: submit the register form, confirm a
   `profiles`/`wallets`/`user_preferences` row exists for the new user
   (via a service-role query in the test setup), follow the local Inbucket
   (or Supabase's local email testing) verification link, confirm
   `profiles.status` flips to `active`, then log in successfully.
2. **Duplicate email**: register the same email twice, expect
   `AUTH_EMAIL_ALREADY_EXISTS` (409) on the second attempt.
3. **Failed login lockout**: submit 5 wrong-password attempts for one
   account from one IP, expect the 6th attempt to return 429
   `RATE_LIMIT_EXCEEDED` regardless of whether the password is now correct;
   confirm the lockout is scoped per-account+IP (a different IP should not
   be blocked).
4. **Forgot/reset password**: request a reset, follow the link, confirm the
   old password no longer works and the new one does.
5. **Expired/invalid link**: hit `/auth/callback` with a garbage `code`
   value, confirm redirect to `/session-expired`.
6. **Logout vs logout-all**: log in from two simulated "devices" (two
   separate browser contexts in Playwright), log out from one, confirm the
   other session is still valid; then call logout-all from one and confirm
   both are now invalidated.
7. **Middleware redirects**: hit a protected route unauthenticated, confirm
   redirect to `/login?redirect_to=<original path>`; log in, confirt
   redirect back to the originally requested path.
8. **Admin/moderator gating**: as a `player`-role account, hit `/admin`,
   expect redirect to `/access-denied`; promote the test account to
   `moderator` directly in the DB, confirm `/admin/moderation` now loads but
   `/admin/users` still redirects to `/access-denied`.
9. **Maintenance mode**: toggle the `maintenance_mode` feature flag on,
   confirm every non-`/maintenance` route redirects there; toggle off,
   confirm normal routing resumes.

## Security tests (extend `supabase/tests/security_tests.sql` from DB-002)

10. Confirm `fn_handle_new_user()` and `fn_handle_user_email_verified()` are
    only triggerable via genuine `auth.users` inserts/updates — attempt to
    call them directly as an `authenticated` role and confirm
    `insufficient_privilege` (they're `security definer` but not exposed as
    callable RPCs, so this should already be structurally impossible; the
    test exists to catch a future accidental `grant execute ... to
    authenticated`).
11. Confirm a user cannot read another user's `user_preferences` row
    (mirrors the wallet-isolation test pattern from DB-002).
12. Confirm the service-role-only logout-all path cannot be reached by a
    client holding only an anon/authenticated session token (i.e. calling
    Supabase's admin API requires the service role key, which is never
    shipped to the client — this is really a code-review check, not a SQL
    test, since the guarantee comes from `lib/supabase/server.ts` never
    being imported into client bundles).

## Middleware unit-test gaps not covered by `middleware.test.ts`

The exported `isPublicPath`/`isAdminPath`/`isModerationPath` helpers are unit
tested directly. The `middleware()` function itself (which also calls
Supabase for the maintenance-flag and profile-role checks) is not
unit-tested here, since mocking `next/server`'s `NextRequest`/`NextResponse`
faithfully enough to be a meaningful test is closer to an integration test —
see item 7–9 above, which cover its actual behavior end-to-end instead of
through a brittle mock.
