# Phase 8.5 — Architecture Guide

A single reference for how ChampionsStake is put together, for anyone who hasn't read all 15 prior phases' individual deliverable docs. Points to the deeper docs for detail rather than re-deriving them.

## Two runtimes, deliberately separate

`apps/web` (Next.js 15, Node.js runtime) and `supabase/functions` (Deno 2 Edge Functions) are **physically separate TypeScript compilation contexts**, not just logically separated — `apps/web/tsconfig.json`'s globs cannot reach two directories up into `supabase/functions/` regardless of configuration, by construction. This was a deliberate fix for a historical bug where the Next.js tsconfig accidentally tried to type-check Deno code. See `docs/ARCHITECTURE_MONOREPO.md` for the full history.

- **Frontend** (`apps/web`): renders every page, proxies authenticated mutations to Edge Functions through internal `app/api/**` routes (never exposes the service-role key to the client), owns session/cookie handling via `@supabase/ssr`.
- **Backend** (`supabase/functions`): ~93 Edge Functions (80 route handlers + 13 shared/logic directories), every route a thin `index.ts` (auth, rate limit, request validation) delegating to a `_module/` (business logic, DB access). Postgres (via Supabase), Auth, Realtime, and Storage are all Supabase-managed.

## The layered systems, in the order they were built

1. **Auth** (Phase 3): session/cookie handling, MFA (TOTP + recovery codes), device tracking, account lockout, CAPTCHA — `docs/AUTH-001-deliverable.md`.
2. **Wallet/Escrow/Ledger** (Phase 1-6): double-entry ledger with structural (not conventional) balance guarantees — see `docs/PHASE8_5_FINANCIAL_VERIFICATION.md` for the full verification chain. `docs/WALLET_ARCHITECTURE.md`, `docs/LEDGER_ARCHITECTURE.md`, `docs/ESCROW_ARCHITECTURE.md`.
3. **Challenges** (Phase 1-2): the core 1v1 wagering primitive — every tournament match reuses this engine directly rather than duplicating it. `docs/CHALLENGE-001-deliverable.md`.
4. **Moderation/Disputes** (Phase 3-4): dispute lifecycle, evidence, moderator decisions gating escrow release. `docs/MODERATOR-001-deliverable.md`.
5. **Realtime/Notifications** (Phase 4): Postgres Changes + Broadcast, `domain_events` → notification dispatch. `docs/REALTIME_PLATFORM.md`.
6. **Security hardening** (Phase 5): rate limiting (Redis-with-Postgres-fallback), CORS, input validation conventions. `docs/RATE_LIMITING_ARCHITECTURE.md`, `docs/SECURITY_ARCHITECTURE.md`.
7. **AI Intelligence Platform** (Phase 7): Trust Engine v2, Risk Engine, Reputation Engine, Fraud Detection, Matchmaking/Recommendation heuristics, AI Moderation Assistant (assistive only, never auto-blocking funds — verified this phase), Analytics Engine.
8. **Tournament Ecosystem** (Phase 8): bracket engine (all 4 formats), Team/League/Season/Ranking (Glicko-1, deliberately independent from trust score) platforms, Organizer/Spectator/Scheduling platforms.
9. **Production hardening** (Phase 8.5, this phase): the audits, fixes, and documents this file is part of.

## The one invariant everything else respects: never duplicate a primitive

This is the single most consistently-enforced architectural rule across all 8.5 phases, and worth naming explicitly since it explains why the codebase looks the way it does:

- Tournament matches are real `challenges` rows, not a parallel match-tracking system.
- All money movement goes through `postBalancedEntries` (`_wallet/ledger.ts`) — no second insert path into `wallet_ledger` exists anywhere.
- Rate limiting is one shared module (`_shared/security/rate-limit.ts`), extended for new endpoints, never reimplemented.
- Notifications flow through one dispatch table (`EVENT_RULES` in `_realtime/notifications.ts`), not per-feature notification logic.
- Realtime reconnection is delegated to the Supabase client's own implementation, not reimplemented per hook.

When you're extending this system, the first question is always "does a primitive for this already exist" before writing new logic — this is why the codebase's own comments so often explain *why* something reuses an existing mechanism rather than just what it does.

## Trust vs. Skill — the one deliberate exception to "share what's shared"

`profiles.trust_score` (fraud/behavior risk) and `player_ratings` (Glicko competitive skill) are **intentionally** separate tables with zero shared storage, per explicit design instruction — see `docs/RANKING_PLATFORM_DESIGN.md` §1. This is not an oversight in the "never duplicate" rule above; trust and skill answer genuinely different questions and conflating them would create real harm (a skilled cheater's high rating masking fraud risk, or a struggling-but-honest new player's low rating looking like a trust problem).

## Where to go next

- New feature work: read the relevant subsystem's design doc first (all named `docs/*_DESIGN.md` or `docs/*-deliverable.md`).
- Operating the system in production: `PHASE8_5_OPERATIONS_MANUAL.md`, `PHASE8_5_MONITORING_GUIDE.md`, `PHASE8_5_RUNBOOKS.md`.
- Something's on fire: `PHASE8_5_INCIDENT_RESPONSE_GUIDE.md`.
- Deploying for the first time: `PHASE8_5_DEPLOYMENT_GUIDE.md`, `PHASE8_5_PRODUCTION_CHECKLIST.md`.
