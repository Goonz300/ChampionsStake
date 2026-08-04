# ChampionsStake

Competitive gaming marketplace with escrow-protected, skill-based challenges.

This repository is built against five approved specification documents, treated
as immutable during implementation:

1. Software Architecture Document v1.0
2. Master Implementation Roadmap v1.0
3. Version 1.0 Readiness Report
4. Business Rules & Workflow Specification v1.0
5. API Specification v1.0 (+ OpenAPI 3.1 contract)

## Status

**Phase 0 — Task INF-001: Project Bootstrap.** Only the Next.js scaffold,
tooling configuration, and folder structure exist so far. No database,
authentication, or business logic has been implemented yet — those are
later Roadmap phases and will land as separate, individually-approved tasks.

## Local setup

```bash
npm install
cp .env.example .env.local   # fill in real values before running
npm run dev
```

## Available scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Start local dev server |
| `npm run build` | Production build |
| `npm run lint` | ESLint (strict — no warnings allowed) |
| `npm run format` / `format:check` | Prettier |
| `npm run typecheck` | `tsc --noEmit`, strict mode |
| `npm test` | Vitest unit tests |

## Folder structure

```
/app
  /(marketing)        — public marketing pages (empty, future task)
  /(app)               — authenticated app shell
    /dashboard /games /challenge/[id] /vault /social /settings
  /(admin)             — role-gated admin/moderator routes
  /api/webhooks        — Stripe / KYC webhook receivers (future task)
/lib
  env.ts               — validated environment loader (this task)
  /payments /escrow /supabase /ai   — empty, future tasks
/supabase
  /migrations /functions            — empty, future tasks
```

## Next task

Per the Roadmap, the next task is **INF-002: Provision Supabase projects
(staging + prod)**, followed by **INF-003: migration tooling + CI migration
check** — both infrastructure tasks that must exist before Phase 1 (Database)
begins. Awaiting approval to proceed.
