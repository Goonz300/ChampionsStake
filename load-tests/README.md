# ChampionsStake Load Testing

## Honest status

**These scripts have never been executed.** No live Supabase project or deployed environment exists in the development environment this suite was built in — there is nothing to point them at. They are written to be genuinely runnable against a real staging environment, not placeholders, but "written to be correct" and "verified to work" are different claims; treat the first run against a real staging environment as a shakedown of the scripts themselves, not just the system under test.

**Never point these at production.** Every scenario here is designed to generate real load, including scenarios that create real database rows (tournaments, registrations, wallet transactions in a test/staging project). Run only against a dedicated staging environment with its own Supabase project, seeded with disposable test accounts.

## Tooling

[k6](https://k6.io/) (Grafana Labs) — chosen because it scripts in JavaScript (this team's primary language), has first-class WebSocket support (needed for the Realtime/connection-count scenarios), and reports latency percentiles/throughput natively without extra tooling. Install: `https://k6.io/docs/get-started/installation/`.

## Prerequisites

1. A staging Supabase project with Phase 1-8.5's full migration set applied.
2. A pool of pre-seeded test accounts (see `seed/` — these scripts assume accounts already exist rather than registering fresh ones mid-test, since account creation itself is one of the scenarios being measured, not a setup step to repeat per virtual user).
3. Environment variables (all scripts read these, never hardcode a target):

```bash
export BASE_URL="https://your-staging-project.supabase.co/functions/v1"
export REALTIME_URL="wss://your-staging-project.supabase.co/realtime/v1"
export SUPABASE_ANON_KEY="..."
export TEST_ACCOUNT_POOL="./seed/test-accounts.json"   # array of {email, password} or {userId, jwt}
export WEBHOOK_SECRET="..."                             # staging-only Paystack webhook secret, for the webhook scenario
```

## Scenarios and their k6 script

| Brief's named scenario | Script | What it measures |
|---|---|---|
| Mass login (100k users) | `k6-auth.js` (scenario: `mass_login`) | Auth throughput, session-issuance latency under ramping concurrent load |
| Mass tournament creation (20k tournaments) | `k6-tournaments.js` (scenario: `mass_creation`) | `tournament-create` throughput, DB write contention under bursty creation |
| Mass registration / 10k concurrent matches | `k6-tournaments.js` (scenario: `mass_registration`, `bracket_generation`) | `tournament-register` throughput, escrow-lock latency, bracket-generation time at scale |
| 5k chats | `k6-chat.js` | `chat-send` throughput, message fan-out latency |
| 50k websocket connections | `k6-realtime-websockets.js` | Connection ramp-up success rate, Realtime's documented connection ceiling (see `PHASE8_5_SCALING_GUIDE.md`) |
| 100 webhooks/sec | `k6-webhooks.js` | `payment-webhook` signature-verification + idempotency-insert throughput under sustained rate |
| 1M notifications/day | `k6-notifications.js` | Derived rate (~11.6/sec sustained, with realistic burst multipliers) against `notification-send`'s `processUnhandledEvents` sweep |
| Mass withdrawals / escrow releases | `k6-wallet.js` | `wallet-transfer`/withdrawal-flow latency and correctness under concurrent load — **pair every run with the reconciliation queries in `docs/PHASE8_5_FINANCIAL_VERIFICATION.md`** to confirm the ledger balance guarantee holds under real concurrent write pressure, not just in unit tests |

## Running a scenario

```bash
k6 run --env BASE_URL=$BASE_URL --env SUPABASE_ANON_KEY=$SUPABASE_ANON_KEY load-tests/k6-tournaments.js
```

Each script supports k6's standard `--vus`/`--duration` overrides, but the scenarios inside each file already define realistic ramp profiles (gradual ramp-up, sustained peak, ramp-down) matching the brief's named target — override only when investigating a specific narrower question.

## What to actually watch during a run

Per `PHASE8_5_MONITORING_GUIDE.md`: p95/p99 latency per endpoint, Postgres connection pool saturation (Supabase dashboard), `wallet_ledger` write latency specifically (the row-locking in `postBalancedEntries` is a deliberate serialization point for wallets under concurrent write pressure — some latency increase under heavy concurrent load to the *same* wallet is expected and correct, not a bug; watch for it becoming disproportionate, not for its mere existence), and Realtime connection count against Supabase's plan-tier ceiling.

## After a run

1. Run every query in `docs/PHASE8_5_FINANCIAL_VERIFICATION.md` against the staging database — a load test that leaves an unbalanced ledger entry or negative balance is the load test finding the single most important class of bug this platform can have.
2. Check `wallet_reconciliation_runs` for any mismatch the automated sweep caught.
3. Record actual p95/p99 numbers in `docs/PHASE8_5_PERFORMANCE_REVIEW.md`'s "load test results" section (currently absent, since no run has ever happened) — replace this README's honesty caveat with real numbers once real numbers exist.
