# Phase 8.5 — Monitoring Guide

What to watch and why — for the underlying logging infrastructure itself, see `docs/PHASE8_5_OBSERVABILITY_GUIDE.md`. No live monitoring stack exists in this development environment to wire these into real alert rules; this document specifies what those rules should be once one exists.

## Tier 1 — page immediately

- **Any `wallet_reconciliation_runs.status = 'completed_with_mismatches'`.** Given the ledger balance guarantee is structurally enforced at three independent layers (`docs/PHASE8_5_FINANCIAL_VERIFICATION.md`), a mismatch firing at all means either an attack or a genuine bug defeated all three — both urgent. See `PHASE8_5_INCIDENT_RESPONSE_GUIDE.md` §1.
- **A negative balance or unbalanced ledger entry** found via `docs/PHASE8_5_FINANCIAL_VERIFICATION.md`'s queries, run ad hoc or scheduled — same severity as above, should be structurally impossible.
- **`health` endpoint reporting `not_ready`** (DB connectivity failure) for more than a brief blip.
- **Any 5xx spike on `payment-webhook`, `wallet-transfer`, `payment-transfer`** — these move real money; an elevated error rate here needs immediate attention, not next-business-day triage.

## Tier 2 — investigate same-day

- **Elevated `429` rate on any endpoint** — could be legitimate load (see `docs/PHASE8_5_SCALING_GUIDE.md`) or an attack; distinguish by checking whether it's concentrated on a few keys (attack-shaped) or spread broadly (real traffic growth).
- **A cron job's `cron.job_run_details` showing repeated failures** — a scheduled sweep silently failing degrades the system gradually (backlogs grow) rather than obviously, which makes it easy to miss without an explicit check.
- **Upstash rate-limit backend falling back to Postgres** (logged explicitly — search for "falling back to Postgres" in Edge Function logs) — expected occasionally under a transient blip, concerning if sustained (means Redis is down or consistently timing out under the new 2s budget from `docs/PHASE8_5_CHAOS_ENGINEERING.md`).
- **Fraud flag volume spike** (`fraud_flags` insert rate) — could indicate a real attack wave or a fraud-detection false-positive regression; check `docs/PHASE8_5_SECURITY_REVIEW.md`/`PHASE7_8_SECURITY_REVIEW.md` context before assuming either.

## Tier 3 — review weekly, not urgent

- `fraud_flags` open-count trend (is the moderation team keeping up with volume, per `moderatorWorkload`).
- Dependency vulnerability status (`npm audit`) — see `docs/PHASE8_5_INFRASTRUCTURE_AUDIT.md`'s residual-risk table.
- Analytics-engine query latency (the safety-valve `.limit()`s added this phase should rarely if ever trigger under normal date-windowed usage — if they start triggering regularly, that's a signal real data volume has grown past what those limits assumed, worth revisiting).

## What "normal" looks like (so you can tell abnormal apart)

- `postBalancedEntries` latency to the *same* wallet under concurrent load: expected to be higher than to distinct wallets (row-locking is deliberate serialization, see `PHASE8_5_PERFORMANCE_GUIDE.md`). Watch for *disproportionate* growth, not mere presence.
- Occasional Upstash → Postgres rate-limit fallback: expected under any transient network blip, not itself an incident.
- `wallet_ledger`/`domain_events`/`audit_logs` growing without bound: expected — these are intentionally append-only. Growth rate acceleration relative to user/transaction growth would be the actual signal worth investigating, not growth itself.

## Structured log fields to search on

Backend (`_shared/logger`): `correlationId`, `requestId`, `userId`, `functionName` — auto-attached per invocation.
Frontend (`apps/web/lib/logger.ts`, added this phase): `userId`, `route`, plus whatever context each call site supplies — passed explicitly per call, not auto-attached (see `PHASE8_5_OBSERVABILITY_GUIDE.md` for why).

## Not yet built

Real alerting rules require a live monitoring/alerting stack (Supabase's own dashboard, or a connected APM) to actually wire these tiers into — see `PHASE8_5_OBSERVABILITY_GUIDE.md`'s Sentry-wiring steps as the concrete next action once a live account exists.
