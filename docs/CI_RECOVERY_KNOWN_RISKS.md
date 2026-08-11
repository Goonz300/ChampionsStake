# Known Risks — CI Recovery / Release Candidate

Consolidated from this phase's audits. Only genuine, evidence-backed items —
nothing invented to pad the list.

## 1. Three residual high-severity vulnerabilities, deferred (not new)

`next`/`postcss`/`sharp` — the only fix path is `next` `15.5.23` → `16.3.0`,
a semver-major migration out of scope for this hardening-only phase. Carried
forward unchanged from Phase 8.5's own documented decision on the identical
finding. See `docs/CI_RECOVERY_DEPENDENCY_AUDIT.md`. **Action for a future
phase**: a dedicated Next.js 16 migration, scoped and tested on its own.

## 2. The exact `ERR_REQUIRE_ESM` regression was not reproduced live on Node 20.11.0

No version manager was available in this environment to install and run the
literal old pinned Node version side-by-side. The root cause is established
via direct, verifiable evidence instead (exact `package.json` `exports`/
`type` fields of the installed `vite`/`vitest`, and Node's own documented
`require(esm)` stabilization versions) — not inference or guesswork — but
it's disclosed here as a methodological limitation rather than glossed over.
See `docs/CI_RECOVERY_ROOT_CAUSE.md`.

## 3. npm 11's install-script allowlist is informational only, not enforced

`esbuild`, `sharp`, and `unrs-resolver` have lifecycle scripts npm flags as
"pending approval" on every install. Confirmed non-blocking (scripts still
run; `sharp`'s native binary loads correctly). Adopting an explicit
`npm approve-scripts` allowlist would be a genuine future supply-chain
hardening step, but is a new standing process, not a fix for something
broken — not applied in this phase. See `docs/CI_RECOVERY_SECURITY_REVIEW.md`.

## 4. Vercel's actual production Node runtime is not controlled by this repo alone

This repo's `.nvmrc`/`engines.node` govern CI and local dev; production Node
version on Vercel is a platform project setting that should be checked/pinned
independently after merge to confirm it matches. See
`docs/CI_RECOVERY_ROLLBACK_GUIDE.md`.

## Not risks (explicitly ruled out during this phase's audits)

- Database: no new migrations this phase; the two most recent (`0106`,
  `0107`) are additive, correctly paired with rollbacks, and migration/
  rollback file counts are 1:1 (107/107).
- Performance: no code paths changed this phase; prior Phase 8.5 fixes
  (parallel wallet reconciliation, `Promise.all` conversions) spot-checked
  and confirmed intact.
- Authorization: the Phase 8.5 moderator-authorization fix and security
  headers spot-checked and confirmed intact.
- Test infrastructure: no skipped/disabled tests (`.skip`/`.only`/
  `Deno.test.ignore`) found in either runtime.
