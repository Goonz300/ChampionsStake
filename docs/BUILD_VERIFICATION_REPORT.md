# ChampionsStake — Build Verification Report

## Environment capability, tested fresh this session

```
$ cd apps/web && npm install
npm error code E403
npm error 403 403 Forbidden - GET https://registry.npmjs.org/@supabase%2fssr
npm error 403 In most cases, you or one of your dependencies are requesting
npm error 403 a package version that is forbidden by your security policy, or
npm error 403 on a server you do not have access to.
```

This is a network-egress restriction of the sandbox this repository was built in, not a property of the repository itself. It has been re-tested, honestly, at the start of every round of this multi-turn build-debugging conversation, with the identical result every time. **I did not run `npm run lint`, `npm run typecheck`, or `npm run build` to a passing state, and I am not claiming to have done so.** Per this task's own explicit instruction ("Do not fabricate successful builds... state that limitation explicitly"), this report says exactly that, plainly, rather than a green checkmark I did not earn.

## What I did verify, with real tools, real output

| Check | Tool | Scope | Result |
|---|---|---|---|
| Bracket/syntax balance | Custom Python parser (string/comment-aware) | All 55 `.ts`/`.tsx` files in `apps/web` after the move | 0 unbalanced |
| `@/` path-alias resolution | Custom Python resolver | All `apps/web` imports | 0 unresolved |
| Edge Function import/export resolution | Custom Python resolver (re-export + `export abstract class` aware) | All 142 files in `supabase/functions` | 0 unresolved (verified before this restructuring; content unchanged since) |
| JSON validity | Python `json.load` | `apps/web/tsconfig.json`, `apps/web/package.json`, root `package.json`, `packages/shared/package.json` | All valid |
| JS syntax validity | `node --check` | `apps/web/eslint.config.mjs` | Valid |
| TypeScript's own include/exclude engine behavior | Real `tsc --noEmit --listFiles` (global tsc 6.0.3 available in this sandbox; project pins 5.7.2 -- version skew disclosed) | Confirmed 0 of 146 previously-compiled files were from `supabase/functions` even under the OLD single-tree layout, before this restructuring made the question structurally moot | Proven, not assumed |
| RLS coverage | Cross-referenced every `create table` against RLS-enabling statements (including DB-001's dynamic-loop pattern) | All 45 tables | 45/45 covered |
| Migration/rollback parity | File count | `supabase/migrations`, `supabase/rollback` | 64/64, unaffected by the move |
| Cross-runtime import leakage | Full grep for relative (`../`) and `@/`-aliased imports crossing the apps/web <-> supabase/functions boundary, before AND after the move | Whole repo | 0 in both directions |

## What genuinely changed vs. what only moved

**Moved, not rewritten**: every `.ts`/`.tsx` file's content in `apps/web` and every file in `supabase/functions` is byte-identical to before this restructuring -- relocated, not regenerated.

**Actually edited** (3 files, all configuration, none of it business logic):
- `apps/web/tsconfig.json` -- removed the now-structurally-unnecessary `"supabase/functions"` exclude entry (it can no longer be reached from `apps/web/` regardless).
- `apps/web/eslint.config.mjs` -- removed the now-unnecessary `ignores: ["supabase/functions/**"]` entry, same reason.
- `.github/workflows/ci.yml` -- split into two independent jobs (`web`, `edge-functions`), the second of which is genuinely new: Deno's own toolchain (`deno fmt`, `deno lint`, `deno check`) was never run against the Edge Functions in CI before this restructuring, since there was no clean boundary to hang a separate job off of.

## Honest bottom line

The unresolved question from the prior build-debugging rounds -- *why* `next build` specifically was still including `supabase/functions` despite a provably-correct `tsconfig.json` exclude -- was never definitively answered, because answering it required executing the actual `next build` internals, which this sandbox cannot do. This restructuring doesn't answer that question either. It makes the question **unaskable going forward**, by removing the shared directory tree the bug depended on. That is a real, verifiable structural fact (confirmed above), not a claim that the original mechanism was diagnosed.

**The one thing this report cannot give you**: a real green `npm install && npm run lint && npm run typecheck && npm run build`, observed by me, in this environment. That requires a machine with npm registry access -- which is exactly what every prior round of this conversation has needed and exactly what remains true now.
