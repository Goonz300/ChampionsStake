# Final Production Report — CI Recovery / Release Candidate

## Executive summary

GitHub Actions' `web` job was failing `npm run test` with `ERR_REQUIRE_ESM`
during `vitest.config.ts` load. Root cause: CI was pinned to Node `20.11.0`,
which predates Node's `require(esm)` interop (stable since `20.19.0`/
`22.12.0`); the immediately prior hardening phase's `vitest` 2.1.8→3.2.7 CVE
fix pulled in `vite@7.x`, a pure-ESM package with zero CommonJS build.
Root-caused with direct evidence (not inference), fixed by bumping the
pinned Node version to `24.18.1` everywhere it's declared, then used as the
occasion for a full re-audit pass across dependencies, the repository,
security, performance, tests, and CI/CD, followed by an independent final
hostile review and a fast-forward merge to `main`.

## CI root cause and fix

See `docs/CI_RECOVERY_ROOT_CAUSE.md` for the full technical account,
including the exact `package.json` `exports`/`type` evidence from both
`vite` and `vitest`. Summary: `node-version` in `.github/workflows/ci.yml`,
`.nvmrc`, and `engines.node` in both `package.json` files bumped to
`24.18.1`/`>=22.12.0`; `@types/node` bumped `22.10.2`→`24.13.3` to match.
Verified via a genuine clean-room `npm ci` reproduction (not just a warm
local install), full pipeline green.

## Audits performed and outcomes

- **Dependency health** (`docs/CI_RECOVERY_DEPENDENCY_AUDIT.md`): 2 low
  vulnerabilities fixed (`eslint`/`@eslint/plugin-kit` ReDoS, non-breaking
  patch bump). 3 high vulnerabilities (`next`/`postcss`/`sharp` chain)
  confirmed unchanged from Phase 8.5's baseline, deferred — fix requires a
  Next.js 15→16 major migration, out of scope for a hardening-only phase.
  Lockfile consistency confirmed via clean-room `npm ci`.
- **Repository audit**: fixed stale Node-version references in two live
  operational docs (`DEPLOYMENT_GUIDE.md`, `PHASE8_5_INFRASTRUCTURE_GUIDE.md`)
  and README's migration count (105→107). No dead code, broken routes, or
  broken doc links found.
- **Database review**: no new migrations this phase; the two most recent
  (`0106`, `0107`) re-verified additive and correctly paired with rollbacks;
  migration/rollback counts confirmed 1:1 (107/107).
- **Security review** (`docs/CI_RECOVERY_SECURITY_REVIEW.md`): Phase 8.5's
  most severe fixes (moderator-authorization throw, security headers,
  wallet-ledger pagination cursor) spot-checked and confirmed intact. Noted,
  not fixed: npm 11's informational (non-blocking) install-script allowlist
  notice — a real future hardening opportunity, not a current defect.
- **Performance review**: no code paths changed this phase; prior `Promise.all`
  and parallel-RPC fixes spot-checked and confirmed intact.
- **Test infrastructure**: no skipped/disabled tests (`.skip`/`.only`/
  `Deno.test.ignore`) in either runtime; `vitest.config.ts`'s path-alias and
  env-var handling reviewed, no issues.
- **CI/CD review** (Phase 9): added `timeout-minutes` to both jobs (previously
  unbounded at GitHub's 360-minute default) and a `concurrency` group with
  `cancel-in-progress` to cancel stale runs on rapid pushes.

## Validation results (final, on merged `main`)

- Deno: `fmt --check` 219 files clean, `lint` 218 files clean, 212/212 tests
  passing.
- Frontend: `format:check`/`lint`/`typecheck` clean, 199/199 Vitest tests
  passing, production build succeeds.
- Clean-room reproduction (`rm -rf node_modules && npm ci`) run twice — once
  pre-merge on the feature branch, once post-merge on `main` itself — both
  fully green, matching exactly what GitHub Actions' `npm ci` step will do.

## Files changed (feature branch → `main`, 16 files)

`.github/workflows/ci.yml`, `.nvmrc`, `README.md`, `apps/web/package.json`,
`deno.lock`, `package.json`, `package-lock.json`, `docs/DEPLOYMENT_GUIDE.md`,
`docs/PHASE8_5_INFRASTRUCTURE_GUIDE.md`, and 7 new `docs/CI_RECOVERY_*.md`
deliverables (root cause, dependency audit, security review, rollback guide,
known risks, release notes, final hostile review).

## Packages upgraded

`eslint` `9.17.0`→`9.39.5`, `@types/node` `22.10.2`→`24.13.3` (plus their
transitive lockfile deltas in both `package-lock.json` and `deno.lock`).

## Commits (branch `fix/ci-recovery-release-candidate`, 9 commits, merged via fast-forward)

`f5405fe` CI fix (Node 24.18.1) · `bbe69d0` CI/CD hardening · `e49b284`
Dependency audit + eslint fix · `30a35f0` Repository audit fixes · `f1026c2`
Security review · `61fc155` RC documentation · `2d40406` Final hostile review
· `97590aa` deno.lock sync fix.

## Merge confirmation

Fast-forwarded `main` (`c54202e` → `97590aa`), pushed, verified local `main`
== `origin/main` == the feature branch's final commit hash byte-for-byte
(`97590aa92a129eabf5155852195de4730f4ced0b`). Re-ran the full validation
pipeline a second time directly on the merged `main` (not just the feature
branch) — fully green. Feature branch deleted both locally and on `origin`.
Working tree clean.

## Remaining risks (see `docs/CI_RECOVERY_KNOWN_RISKS.md` for full detail)

1. 3 residual high-severity vulnerabilities requiring a deferred Next.js 16
   migration.
2. The original `ERR_REQUIRE_ESM` failure was root-caused via direct evidence
   rather than a literal live reproduction on Node 20.11.0 (no version
   manager available in this environment) — disclosed as a methodological
   limitation, not hidden.
3. Vercel's actual production Node version is a platform setting independent
   of this repo's `.nvmrc`/`engines.node` and should be confirmed/pinned
   separately post-merge.
4. npm 11's install-script allowlist is currently informational-only; adopting
   an explicit allowlist is a real but non-urgent future hardening step.

## Release recommendation

Ship. The CI regression that was the explicit primary objective of this phase
is fixed and verified via genuine clean-room reproduction, not worked around.
Every phase's changes were individually validated through the full pipeline
before being committed. The final hostile review, deliberately scoped to
attack this phase's own diff (the only real attack surface, given Phase 8.5's
recent exhaustive application-level review), found zero new defects. All
merge-gate conditions were satisfied before merging.

## Confidence score: 90/100

Higher than Phase 8.5's own 82/100: the change surface here is much smaller
and more mechanical (version bumps, CI config, docs — no new application
logic), each step was independently re-validated end to end (including twice
on `main` itself post-merge), and the one genuine gap the process itself
caught (deno.lock drift) was found and fixed before merge rather than after.
Points held back for: the 3 deferred high-severity vulnerabilities requiring
a future Next.js major migration, and the inability to literally execute the
old failing configuration in this sandboxed environment (mitigated, not
eliminated, by strong direct evidence).
