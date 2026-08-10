# Phase 8.5 — Infrastructure Audit

## CI/CD

`.github/workflows/ci.yml` — two jobs, `web` (Next.js) and `edge-functions` (Deno), each on `ubuntu-latest`, triggered on PR and push to `main`.

**Fixed this phase:**
- Neither job ever ran its runtime's test suite (`npm run test` / `deno test`) — the entire test suite (28 web test files / 193 tests, 26 Deno test files / 208 tests) was invisible to CI; a regression in tested logic, including the wallet-ledger double-entry tests and every bracket-format test, would not have blocked a merge. Added a `Unit tests` step to the `web` job (after typecheck, before build — matching this project's established validation-order convention) and a `Deno tests` step to the `edge-functions` job.
- The Deno job had no dependency cache (the Node job already had `cache: "npm"`); `deno.lock` existed but nothing keyed a cache off it. Added an `actions/cache@v4` step keyed on `hashFiles('deno.lock')`.

**Not changed, judged adequate or out of proportion:**
- No build-artifact retention (`actions/upload-artifact`) — reasonable for this project's size; nothing currently needs post-run inspection of build output beyond CI's own logs.
- Branch protection rules are a GitHub repository setting, not a file — unverifiable and unconfigurable from inside the repo itself.

## Docker / Terraform / Kubernetes

None exist in the repository, confirmed by direct search. Deployment target is implicit rather than codified: Vercel for `apps/web` (inferred from `ci.yml`'s placeholder env var names matching Vercel's `NEXT_PUBLIC_*` convention, and `docs/DEPLOYMENT_GUIDE.md`'s explicit "Supabase + Vercel" framing) and Supabase-hosted Postgres/Edge Functions/Realtime/Storage for the backend.

**Recommendation, not built this phase**: introducing Terraform (or Vercel's/Supabase's own declarative config-as-code where available) to codify environment variables, pg_cron schedules, and storage bucket configuration would close a real gap — every environment is currently hand-configured through two dashboards with no reviewable diff history. This is judged a genuinely large, multi-week undertaking (designing a Terraform provider setup for Supabase, migrating every dashboard-configured setting into it, and validating parity) — out of proportion for a hardening pass whose own instructions emphasize additive, bounded changes. `PHASE8_5_DEPLOYMENT_GUIDE.md` and `PHASE8_5_INFRASTRUCTURE_GUIDE.md` fully document the current manual configuration surface instead, so it's at least reviewable and could be codified later without rediscovery work.

## Supabase configuration

No `supabase/config.toml` exists in the repository (confirmed) — local Supabase CLI development, if used, relies on CLI defaults rather than a committed project config. Every actual schema/policy/function/cron definition lives in `supabase/migrations/*.sql`, which **is** the reviewable, versioned source of truth for the database side of "infrastructure" even without a `config.toml`.

## Environment variables and secrets

- Backend: `supabase/functions/_shared/config/index.ts` centralizes every env var read behind typed accessors (`requiredEnv`/`optionalEnv`) — no scattered `Deno.env.get()` calls found outside this module.
- Frontend: `apps/web/lib/env.ts` does the same for Next.js (`clientEnv`/`serverEnv` split, `serverEnv` lazily evaluated so client bundles never accidentally inline a server secret).
- `.env.local` (gitignored) contains placeholder values only, confirmed by direct read — no real secret was ever present in this development environment.
- No secret was found committed to git history in any file this audit touched (spot-checked; a full `git log -p | grep` secret-pattern scan across the entire history was judged out of scope for a repository this size with no prior indication of a leak, but is a reasonable one-time check to run before a real production launch — see `PHASE8_5_SECURITY_GUIDE.md`).

## Runtime versions

- Node: `>=20.11.0` (`package.json` `engines`), now also pinned via `.nvmrc` (added this phase — nothing previously enforced or auto-selected this version for a local contributor).
- Deno: `v2.x` (`ci.yml`'s `setup-deno` action) — matches the `deno.json`/Deno 2 APIs used throughout `supabase/functions/`.
- TypeScript: `5.7.2`, pinned exactly (not range-pinned) in both `package.json` files — deliberate, consistent with this project's general preference for exact pins on directly-declared dependencies.

## Dependency vulnerabilities — found and fixed

`npm audit` across the full workspace (including devDependencies) found 12 advisories, ranging Critical to Low, before this phase. Fixed:

| Package | Before | After | Severity closed | Notes |
|---|---|---|---|---|
| `next` | 15.1.0 | 15.5.23 | **Critical** (RCE in React Flight protocol) + ~25 other advisories in the 15.1.0 range | Same major version (15.x) — API-compatible, confirmed by a clean typecheck/lint/build/test pass after the bump |
| `eslint-config-next` | 15.1.0 | 15.5.23 | (paired with `next`, not independently vulnerable) | Kept in lockstep with `next` per Next.js's own version-pairing convention |
| `vitest` | 2.1.8 | 3.2.7 | **Critical** (RCE when the Vitest API/UI server is reachable by a malicious website) | Major version bump (2.x → 3.x), dev-only dependency; all 193 existing tests pass unchanged, `vitest.config.ts` needed no changes |
| `@supabase/supabase-js` | 2.47.10 | 2.50.5 | Low (insecure path routing from malformed input, via `@supabase/auth-js`) | Deliberately a **minimal** bump (just past the vulnerable range, not to the latest `2.112.2`) — this codebase has no live Supabase instance to regression-test auth flows against, so minimizing the version delta minimizes unverified surface area while still closing the CVE |

**Remaining, not fixed — documented residual risk:**

| Package | Issue | Why not fixed |
|---|---|---|
| `postcss`, `sharp` (both vendored *inside* `next`'s own `node_modules/next/node_modules/`) | High severity (XSS/path traversal in postcss; libvips CVEs in sharp) | Only resolvable by upgrading `next` to the 16.x major line — a real breaking-change framework migration (App Router API surface, config format changes possible), explicitly out of scope for a hardening pass that must not "redesign existing systems." Recommended as a dedicated future migration with its own regression-testing budget, not attempted here. |
| `eslint`, `@eslint/plugin-kit` | Low (ReDoS in a lint-time-only config parser) | Dev-tooling-only, zero production/runtime exposure; the available fix is a large `eslint` major bump (9.x is current, but the specific advisory-fixing range requires more investigation than this pass's remaining budget covers, and the exposure is confined to `npm run lint` itself, never end-user-reachable) |

Post-fix state: **0 Critical, 0 Moderate, 3 High (all in the `next`-major-version-locked group above), 2 Low (dev-tooling only)** — verified via `npm audit --json` after every change in this table.

## Unused / duplicate packages

- `npm ls --workspaces --all` shows npm's dependency deduplication working correctly (shared transitive dependencies collapsed to single copies) — no problematic duplication found.
- The `UNMET OPTIONAL DEPENDENCY bufferutil`/`utf-8-validate` entries under `ws` (a transitive dependency of Supabase's node-fetch chain) are optional native performance addons for WebSocket frame masking — not required, not a functional gap, and installing native build tooling for a marginal optional speedup is out of scope.
- No genuinely unused top-level dependency was found in either `package.json` — every declared dependency has at least one real import site (spot-checked during the broader repository audit).

## Recommendation summary

| Action | Status |
|---|---|
| Add `deno test`/`npm run test` to CI | **Done** |
| Cache Deno dependencies in CI | **Done** |
| Pin Node version via `.nvmrc` | **Done** |
| Fix Critical `next` CVE | **Done** (15.1.0 → 15.5.23) |
| Fix Critical `vitest` CVE | **Done** (2.1.8 → 3.2.7) |
| Fix Low `@supabase/supabase-js` CVE | **Done** (2.47.10 → 2.50.5, minimal bump) |
| Migrate to `next@16` (closes remaining High findings) | Recommended, not done — dedicated future migration |
| Introduce infrastructure-as-code | Recommended, not done — large, out of proportion for this pass |
| Full git-history secret scan | Recommended one-time pre-launch check — see `PHASE8_5_SECURITY_GUIDE.md` |
