# ChampionsStake

Competitive gaming marketplace with escrow-protected challenges. Official domain: `championsstake.app`.

## Monorepo layout

```
apps/web/            Next.js 15 application (Node runtime, npm workspace)
supabase/functions/   Supabase Edge Functions (Deno runtime -- NOT an npm workspace)
supabase/migrations/  Database schema (107 migrations)
supabase/rollback/     Matching rollback script per migration
supabase/tests/        SQL-level security/integration tests
packages/shared/       Reserved for genuinely cross-runtime code (currently empty -- see its own README)
docs/                  Architecture, business rules, API spec, and every phase's deliverable report
```

**Why `apps/web` and `supabase/functions` are physically separate, not just configured apart**: they are two different TypeScript compilation contexts by construction -- `apps/web/tsconfig.json`'s globs resolve relative to `apps/web/`, and can never reach two directories up into `supabase/functions/`, regardless of any `include`/`exclude` setting. See `docs/ARCHITECTURE_MONOREPO.md` for the full reasoning, including the specific build bug this structure was created to permanently resolve.

## Quick start

```
npm install          # installs the apps/web workspace (packages/shared has no deps yet)
npm run dev           # -> apps/web
npm run build          # -> apps/web
npm run lint            # -> apps/web
npm run typecheck        # -> apps/web
```

Edge Functions are deployed and verified independently, via the Supabase CLI and Deno's own toolchain -- see `docs/DEPLOYMENT_GUIDE.md`.

## Documentation index

- `docs/ARCHITECTURE_MONOREPO.md` -- this restructuring, why, and what it fixes
- `docs/DEPLOYMENT_GUIDE.md` -- full deploy steps (Supabase + Vercel)
- `docs/ENV_REFERENCE.md` -- every environment variable, which runtime reads it
- `docs/BUILD_VERIFICATION_REPORT.md` -- what was actually verified, honestly, and what requires a real environment
- `docs/*-deliverable.md` -- one report per implementation phase (18 phases, AUTH-001 through PAYMENT-001/PROD-001)
