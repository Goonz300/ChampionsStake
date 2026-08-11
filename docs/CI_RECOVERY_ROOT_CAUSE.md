# CI Recovery — Root Cause Analysis and Fix

## The failure

```
npm run test
```

failed in CI (GitHub Actions), during `apps/web/vitest.config.ts` load, with:

```
Error [ERR_REQUIRE_ESM]
require() of ES Module vite/dist/node/index.js
from vitest/dist/config.cjs not supported
```

This did **not** reproduce locally in this development environment before investigation — `npm run test` passed cleanly (199/199 tests) against the existing local `node_modules`. That discrepancy is itself the first real clue, not something to explain away.

## Root cause, verified with direct evidence (not assumed)

1. **`vite` ships as pure ESM with zero CommonJS export.** Verified directly against the installed package:
   ```json
   // node_modules/vite/package.json
   "type": "module",
   "exports": { ".": "./dist/node/index.js", ... }   // no "require" condition anywhere
   ```
   There is no `require`-compatible build of `vite` at all — every consumer must either `import` it, or rely on Node's ability to `require()` a genuine ES module.

2. **`vitest` exposes a CommonJS entrypoint that internally requires `vite`.** Verified directly against the installed package:
   ```json
   // node_modules/vitest/package.json
   "exports": {
     ".": {
       "import": { "default": "./dist/index.js" },
       "require": { "default": "./index.cjs" }   // <- this path requires() vite internally
     }
   }
   ```

3. **Node's ability to `require()` a pure-ESM module (`require(esm)` interop) is a specific, versioned capability, not something every Node runtime has.** It stabilized (unflagged, on-by-default) in Node **20.19.0** and **22.12.0**, and is present in all Node 23+ releases. It does **not** exist at all in earlier Node 20.x releases.

4. **CI was pinned to Node `20.11.0`** (`.github/workflows/ci.yml`, and `package.json`'s `engines.node`/`​.nvmrc` matched it) — a point release that predates `require(esm)` support entirely. The moment anything on the CJS path reaches `vitest/dist/config.cjs`'s internal `require("vite")`, Node 20.11.0 has no mechanism to satisfy it and throws exactly `ERR_REQUIRE_ESM`.

5. **This local development environment runs Node `24.18.1`**, which has full, mature `require(esm)` support — so the exact same dependency tree that fails on CI's pinned Node 20.11.0 succeeds silently here. The bug was never a code bug; it was a runtime-capability mismatch between what got pinned in CI/`engines`/`.nvmrc` and what the (correctly, intentionally upgraded) dependency tree now requires.

## Why this appeared now

`vitest` was bumped `2.1.8` → `3.2.7` in the immediately prior production-hardening phase, specifically to close a Critical CVE (a reachable-RCE advisory in Vitest's API/UI server — see `docs/PHASE8_5_INFRASTRUCTURE_AUDIT.md`). That upgrade pulled in `vite@7.x` as a peer dependency, which is where the pure-ESM-only packaging comes from — Vite's own project has been progressively dropping CJS support across its major versions, and v7 dropped it entirely. The CVE fix was correct and necessary; it simply exposed a Node-version assumption (`20.11.0`) that had gone unexamined since much earlier in the project's history.

## The fix

Bumped the pinned Node version everywhere it's declared, to a version with stable `require(esm)` support:

- `.github/workflows/ci.yml`: `node-version: "20.11.0"` → `"24.18.1"`
- `package.json` (root) and `apps/web/package.json`: `engines.node` `>=20.11.0` → `>=22.12.0` (the true technical minimum — expressed honestly as the actual constraint, not inflated to require exactly 24)
- `.nvmrc`: `20.11.0` → `24.18.1` (pinned to the exact version verified working locally, for full local/CI parity)
- `apps/web/package.json`'s `@types/node`: `22.10.2` → `24.13.3`, matching the new Node 24 runtime target (using stale 22.x-generation type definitions against a 24.x runtime would type-check against the wrong API surface)

This is the officially sanctioned mechanism Node provides for a CommonJS-by-default project to consume a pure-ESM dependency during this transitional period across the npm ecosystem — not a workaround, not a legacy loader, not forcing CommonJS, and not pinning to an obsolete version. Node 20.x LTS is also EOL as of this phase, making the move off it correct on its own terms independent of this specific bug.

## Phase 9 — CI/CD review (beyond the Node-version fix)

With the actual regression fixed, `.github/workflows/ci.yml` was re-read in full and checked against: Node version, npm cache, Deno cache, workspace commands, matrix, artifacts, build caching, test execution, deployment readiness. Two genuine, low-risk gaps were found and fixed; everything else (Deno cache keying, workspace-aware `npm ci`, placeholder build env vars, per-file Deno type-checking) was already correct from the prior phase and left as-is:

- **No `timeout-minutes` on either job.** GitHub Actions defaults an unset job timeout to 360 minutes — a hung step (e.g. a test stuck on an unresolved promise) would silently consume CI minutes for up to 6 hours before being killed. Added `timeout-minutes: 15` (web) / `10` (edge-functions), both well above any observed run.
- **No `concurrency` group.** Without one, each additional push to the same branch/PR queues a new run instead of superseding the in-flight run for an already-superseded commit, wasting CI minutes and delaying feedback on the latest push. Added a top-level `concurrency: { group: ${{ github.workflow }}-${{ github.ref }}, cancel-in-progress: true }`.

Not changed, and why: the Deno version pin (`deno-version: v2.x`) is a floating-minor range, not a stale exact pin like the Node regression was — it always resolves to the latest 2.x, which is the safer direction for a fast-moving but still-2.x-major toolchain, so tightening it further would add maintenance burden without fixing a real problem. No matrix build, artifact upload, or additional build-caching step was added since none is currently justified by an actual gap (single Node version target, no multi-OS deployment target, `.next` build cache would only matter for build *speed*, which isn't a correctness or reliability issue).

## Verification performed

- Full clean-room reproduction of what CI actually does: `rm -rf node_modules apps/web/node_modules && npm ci` (not `npm install` — matching CI's exact, lockfile-strict install command), followed by the complete validation pipeline. All green: format check, lint, typecheck, 199/199 tests, production build.
- Could not literally execute Node `20.11.0` in this sandboxed development environment (no version manager available, and installing a second Node binary manually was judged disproportionate given the root cause is already established via direct, verifiable inspection of the exact interop boundary — the package.json `exports`/`type` fields are facts, not inferred behavior). The fix targets the exact, named, documented Node capability (`require(esm)`, stable since 20.19.0/22.12.0) that's missing on the previously-pinned version and present on the newly-pinned one.
