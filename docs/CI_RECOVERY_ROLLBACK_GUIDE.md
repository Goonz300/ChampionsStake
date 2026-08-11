# Rollback Guide — CI Recovery / Release Candidate

This phase's changes are almost entirely CI configuration, dependency-version,
and documentation edits — no schema migrations, no application logic changes.
Rollback is correspondingly simple.

## If the Node 24 runtime bump causes an unexpected production issue

The Node version bump (`.nvmrc`, `engines.node`, CI's `setup-node`) only
affects: (1) what GitHub Actions builds/tests against, and (2) what a local
dev environment is told to run. It does **not** by itself change what Vercel
runs in production — Vercel's Node runtime is controlled by its own project
setting (or a `"engines"` field it reads from `apps/web/package.json`, now
`>=22.12.0`). If Vercel picks up a newer Node than expected and something
regresses:

1. In the Vercel project settings, pin the Node.js version explicitly (Vercel
   supports 22.x and 24.x as of this writing) rather than relying on the
   `engines` range, to decouple the platform runtime from this repo's own
   CI/dev-environment pin.
2. If a genuine incompatibility is found, revert this phase's four version
   files as a unit: `.github/workflows/ci.yml` (`node-version`), `.nvmrc`,
   `package.json` (root `engines.node`), `apps/web/package.json` (`engines.node`,
   `@types/node`) — do not revert only some of them, since they're required to
   stay mutually consistent (see `docs/CI_RECOVERY_ROOT_CAUSE.md`). Reverting
   Node without also reverting `vitest`/`vite` (Phase 8.5) would immediately
   reintroduce the original `ERR_REQUIRE_ESM` CI failure this phase fixed.

## If the `eslint` patch bump (9.17.0 → 9.39.5) causes a lint false-positive/negative

Revert `apps/web/package.json`'s `eslint` line and `package-lock.json` (`git
checkout <prior-commit> -- apps/web/package.json package-lock.json && npm
install`). This is an isolated, single-package change with no other coupled
files.

## If the CI hardening (job `timeout-minutes`, `concurrency` cancellation) misbehaves

Both are additive blocks in `.github/workflows/ci.yml` with no dependency on
anything else changed this phase. Delete the `concurrency:` block and/or the
two `timeout-minutes` lines to restore the prior (unbounded) behavior.

## General

No database migrations were added or altered in this phase, so the existing
`supabase/rollback/` per-migration rollback scripts and
`docs/DISASTER_RECOVERY_GUIDE.md` remain the authoritative path for any
schema-level rollback need — unaffected by anything in this phase.
