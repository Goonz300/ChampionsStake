# Release Notes — CI Recovery / Release Candidate

## Summary

Fixes a real, previously-failing GitHub Actions CI regression (`ERR_REQUIRE_ESM`
in `npm run test`) and performs a hardening/audit pass on top of it. No new
product features. No database schema changes.

## Fixed

- **CI regression**: GitHub Actions' `web` job failed on `npm run test` with
  `Error [ERR_REQUIRE_ESM]: require() of ES Module vite/dist/node/index.js
  from vitest/dist/config.cjs not supported`. Root cause: CI was pinned to
  Node `20.11.0`, which predates Node's `require(esm)` interop (stable since
  20.19.0/22.12.0); the immediately prior phase's `vitest` 2.1.8→3.2.7 CVE fix
  pulled in `vite@7.x`, which ships pure ESM with no CommonJS build at all.
  Fixed by bumping the pinned/required Node version to `24.18.1`/`>=22.12.0`
  everywhere it's declared (`.github/workflows/ci.yml`, `.nvmrc`, both
  `package.json`'s `engines.node`), plus `@types/node` `22.10.2`→`24.13.3` to
  match. Full details: `docs/CI_RECOVERY_ROOT_CAUSE.md`.
- **2 low-severity vulnerabilities**: `eslint`/`@eslint/plugin-kit` ReDoS,
  fixed with a same-major-line patch bump (`9.17.0`→`9.39.5`).
- **Stale documentation**: `README.md`'s migration count (105→107, missing
  the prior phase's own two migrations), and two live operational docs
  (`docs/DEPLOYMENT_GUIDE.md`, `docs/PHASE8_5_INFRASTRUCTURE_GUIDE.md`) that
  still instructed readers to use the now-incompatible Node `>=20.11.0`.

## Hardened

- CI: added `timeout-minutes` to both jobs (previously defaulted to GitHub's
  360-minute ceiling) and a `concurrency` group with `cancel-in-progress` so
  rapid successive pushes cancel stale in-flight runs instead of queuing.

## Verified, not changed

- Database (migrations/rollbacks 1:1, additive-only convention intact).
- Security (Phase 8.5's moderator-authorization fix, security headers,
  wallet-ledger pagination fix all spot-checked and confirmed intact).
- Performance (prior `Promise.all` and parallel-RPC fixes confirmed intact).
- Test infrastructure (no skipped/disabled tests in either runtime).

## Deferred

See `docs/CI_RECOVERY_KNOWN_RISKS.md` — three residual high-severity
vulnerabilities requiring a Next.js 15→16 major-version migration, and an
optional (non-blocking) npm supply-chain hardening opportunity.

## Upgrade notes for anyone pulling this branch

- Requires Node `>=22.12.0` locally now (was `>=20.11.0`). Run `nvm use` (or
  equivalent) to pick up `.nvmrc`'s `24.18.1` after pulling.
- `npm ci` regenerates `node_modules` against the updated lockfile; no manual
  cache-clearing should be necessary.
