# Phase 8.5 — Security Guide

Operational security reference — for the point-in-time findings this phase's audit produced, see `docs/PHASE8_5_SECURITY_REVIEW.md` instead. This document is about ongoing practice, not a snapshot.

## Secrets

Every secret is read through a single typed accessor module per runtime (`supabase/functions/_shared/config/index.ts` for the backend, `apps/web/lib/env.ts` for the frontend) — confirmed during this phase's audit that no code reads an env var any other way. When adding a new secret, add it to the relevant config module, not a scattered `Deno.env.get()`/`process.env` call.

**Rotation**: no automated rotation exists for any secret (Supabase keys, Paystack keys, Resend key, Upstash tokens, webhook secrets) — this is standard for a project this stage, but before a real launch, establish who owns rotation and on what cadence, particularly for the service-role key (full DB access) and the Paystack secret key (payment provider access).

**One-time pre-launch check, not yet performed**: a full `git log -p | grep` (or equivalent) scan of the entire git history for any accidentally-committed secret pattern. No indication one exists (every `.env.local` found during this phase's audits contained only placeholder values), but a repository with this much history deserves one explicit check before going live, not an assumption.

## Role grants — who can grant what

| Role | Grants | Who can grant it |
|---|---|---|
| `organizer` | Tournament/league creation | Administrator only (admin-granted, not self-service — real-money risk, see `docs/ORGANIZER_PLATFORM_DESIGN.md`) |
| `moderator` | Dispute resolution | Administrator only |
| `administrator` | Everything | Existing administrator only (bootstrap the first one directly in the database) |
| `support` | Read-mostly support tooling | Administrator only |

Every role check in the codebase re-verifies the account is active (not suspended/closed) at the same time as checking the role — a suspended moderator/admin does not retain elevated access just because their `role` column wasn't separately changed.

## The dispute-assignment lesson (from this phase's hostile review)

The most severe finding this phase's independent hostile review produced (`docs/PHASE8_5_SECURITY_REVIEW.md`'s High finding) was an inverted conditional that made an entire authorization check a silent no-op — any moderator could act on any dispute regardless of assignment, for months, without any test catching it (the module had zero test coverage before this phase). **The operational lesson**: a security-critical authorization check with no test is a check nobody has actually verified works, regardless of how it reads. `_admin/` and `_moderator/` (both self-described "security-critical" in their own code comments) had zero test files before this phase — closing that gap for the remaining untested functions in both directories is the single highest-value follow-up security investment, higher priority than any new feature.

## Security headers and cookies

CSP/HSTS/X-Frame-Options/X-Content-Type-Options are set platform-wide (`apps/web/next.config.ts`'s `headers()`, added this phase). `script-src`/`style-src` currently allow `'unsafe-inline'` because Next.js's App Router injects an inline hydration script — a stricter nonce-based CSP is documented as a future improvement requiring live-browser verification this development environment can't provide (see `PHASE8_5_SECURITY_REVIEW.md`). Auth cookies carry `Secure` in production (`apps/web/lib/supabase/cookie-options.ts`); `httpOnly` is deliberately left at `@supabase/ssr`'s default (`false`) because the browser-side client needs direct `document.cookie` access for real functionality — this is the library's own intentional design, confirmed by reading its actual defaults rather than assumed.

## Dependency hygiene

`npm audit --omit=dev` (frontend) and periodic review of `deno.lock`'s resolved versions (backend) — this phase found and fixed 2 Critical CVEs (`next`, `vitest`) that had gone unpatched. Residual risk (`next`/`postcss`/`sharp`, only closable via a `next@16` major-version migration) is documented in `docs/PHASE8_5_INFRASTRUCTURE_AUDIT.md` — track it, don't forget it because it wasn't fixed this phase.

## What to do if you find a new vulnerability

1. Confirm it's real with a concrete exploit sequence (not a theoretical concern) — this codebase's hostile-review convention (see every `PHASE*_SECURITY_REVIEW.md`) exists precisely to avoid chasing phantom findings.
2. Classify severity honestly (Critical/High/Medium/Low) based on actual impact and likelihood, not worst-case imagination.
3. Fix Critical/High immediately; write a regression test that specifically pins the exploit scenario (see `_moderator/authorization-heuristics.test.ts` for the pattern — a test that would have caught the inverted-condition bug this phase found).
4. Document it in a dated security review doc, not just a commit message — future audits (like this one) rely on being able to trust that a previously-reviewed area actually was reviewed.
