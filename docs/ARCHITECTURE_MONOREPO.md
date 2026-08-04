# ChampionsStake — Monorepo Architecture

## Why this restructuring happened

Across several build-debugging rounds, `next build` kept including `supabase/functions/**` (Deno Edge Function source) in its TypeScript compilation, despite a correctly-configured `tsconfig.json` `exclude` field. Direct testing with `tsc --noEmit --listFiles` against that exact tsconfig proved TypeScript's own engine honored the exclude correctly (0 of 146 compiled files were from `supabase/functions`) -- meaning the discrepancy lived inside `next build`'s own internal build pipeline or `typescript-eslint`'s `projectService`, neither of which could be directly inspected without a working `npm install` (blocked by this environment's network policy throughout every phase of this project).

Rather than keep patching a single shared `tsconfig.json`/`eslint.config.mjs` and re-verifying an internal mechanism no one could fully observe, this restructuring removes the possibility of that class of bug **by construction**: `apps/web/` and `supabase/functions/` are no longer in the same directory tree at all. `apps/web/tsconfig.json`'s `include: ["**/*.ts", ...]` resolves relative to `apps/web/` -- it is physically two directories away from `supabase/functions/` and cannot glob-match anything inside it, regardless of `exclude` settings, tool version quirks, or `projectService` internals. The fix no longer depends on a configuration flag being interpreted the way its documentation says it should be; it depends on `apps/web/**/*.ts` not matching a path that starts `../../supabase/`, which is a directory-structure fact, not a tool behavior.

## Two independent runtimes, two independent toolchains

| | `apps/web` | `supabase/functions` |
|---|---|---|
| Runtime | Node (via Next.js/Vercel) | Deno |
| Package manager | npm (workspace) | none -- Deno has no `node_modules` |
| Import convention | no extensions, bundler resolution | explicit `.ts` extensions, required by Deno |
| Type checking | `tsc`/`next build`, `apps/web/tsconfig.json` | `deno check`, no tsconfig at all |
| Linting | ESLint (`apps/web/eslint.config.mjs`) | `deno lint` |
| CI job | `.github/workflows/ci.yml` -> `web` | `.github/workflows/ci.yml` -> `edge-functions` (new -- this runtime was never independently verified in CI before this restructuring) |
| Deploy target | Vercel | `supabase functions deploy` |

Zero code is imported across this boundary in either direction -- verified by exhaustive import-graph analysis before and after the move (see `docs/BUILD_VERIFICATION_REPORT.md`). They communicate exclusively over HTTP: the Next.js app calls deployed Edge Function URLs, the same way any external client would.

## What did NOT change

Every migration (64), every Edge Function's business logic, every RLS policy, every domain library (`_wallet`, `_challenge`, `_tournament`, `_moderator`, `_admin`, `_ai`, `_payment`, `_realtime`) is byte-for-byte what it was before this restructuring -- moved, not rewritten. The implementation phases' worth of accumulated audits (RLS coverage, idempotency coverage, import resolution, state-machine edge verification) all still describe the actual code, because the actual code didn't change.
