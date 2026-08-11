# Phase 3 — Dependency Health Audit

Scope note: this codebase went through a full dependency audit in the immediately
prior phase (`docs/PHASE8_5_INFRASTRUCTURE_AUDIT.md`). Since then, the only
dependency-relevant changes are this phase's own Node version bump (Phase 1-2)
and CI hardening (Phase 9), which touched no `package.json` dependency versions.
This pass re-verifies that baseline and checks anything genuinely new.

## Vulnerabilities (`npm audit --workspaces`)

Before this phase: 5 vulnerabilities (2 low, 3 high) — matches Phase 8.5's
documented baseline exactly, confirming nothing regressed between phases.

- **2 low — `eslint` / `@eslint/plugin-kit` ReDoS** (`GHSA-xffm-g5w8-qvg7`).
  Fix was non-breaking (`eslint` `9.17.0` → `9.39.5`, same major line). Applied.
  Verified: lint, typecheck, format check, all 199 unit tests, and a production
  build all still pass on the bumped version; a clean-room `npm ci` confirms the
  lockfile is consistent.

- **3 high — `next` / `postcss` / `sharp` chain** (`GHSA-qx2v-qp2m-jg93`,
  `GHSA-6g55-p6wh-862q`, `GHSA-r28c-9q8g-f849`, `GHSA-fxqj-rqcc-2cmp`,
  libvips CVEs behind `sharp`). The only fix path is `next` `15.5.23` → `16.3.0`,
  a semver-major jump (`npm audit` itself flags it `isSemVerMajor: true`).
  **Not applied.** A Next.js major version migration is a large, independently
  risky change (breaking API surface, needs its own dedicated test pass) that
  doesn't belong inside a CI-recovery/hardening phase with an explicit
  "zero new feature development" mandate — bundling it here would violate the
  same discipline that keeps this phase's diff auditable. This matches Phase
  8.5's own decision on the identical finding. Tracked as a known, deferred
  risk for a dedicated future migration, not silently dropped.

After this phase: 3 vulnerabilities (0 low, 3 high) — the 2 low findings are
resolved; the 3 high findings are the same pre-existing, already-triaged,
deferred risk carried forward.

## Lockfile / clean-install consistency

`rm -rf node_modules apps/web/node_modules && npm ci` (the same command CI's
`web` job runs) succeeds cleanly against the current `package-lock.json` with
no lockfile-drift warnings and no peer-dependency warnings.

## Deprecated / unused / duplicate packages

No dependency additions or removals happened in this phase beyond the `eslint`
patch bump above, so the unused/duplicate-package status documented in Phase
8.5's infrastructure audit is unchanged. No new findings.

## Currency (informational only — not a defect)

`npm outdated` shows several packages with newer major versions available
(`next` 15→16, `typescript` 5→7, `tailwindcss` 3→4, `zod` 3→4, `vitest` 3→4,
`eslint` 9→10, `@supabase/ssr` 0.5→0.12, `@supabase/supabase-js` 2.50→2.112).
None of these are flagged by `npm audit` as vulnerable at the currently pinned
versions — being behind the latest major release is normal dependency drift,
not a genuine defect, and bumping any of them is an architecture-level decision
with its own testing burden, out of scope for this hardening pass. Not treated
as a finding requiring action.

## Node/`@types/node` version alignment (from Phase 1-2)

`engines.node` (`>=22.12.0`), `.nvmrc` (`24.18.1`), CI's `actions/setup-node`
(`24.18.1`), and `@types/node` (`24.13.3`, matching the Node 24 API surface)
are all mutually consistent. No drift found.
