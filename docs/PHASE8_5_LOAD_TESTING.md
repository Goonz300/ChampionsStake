# Phase 8.5 — Load Testing

## Status: harness built, never executed

No live Supabase project or deployed environment exists in this development environment — there is nothing to run these scripts against. The deliverable for this step is a genuinely runnable [k6](https://k6.io/) test harness (`load-tests/`), not fabricated benchmark numbers. See `load-tests/README.md` for the full prerequisites, scenario list, and post-run checklist — this document is the summary; that one is the operational reference.

## What was built

| Scenario (brief target) | Script |
|---|---|
| Mass login (100k users) | `load-tests/k6-auth.js` |
| Mass tournament creation (20k tournaments) | `load-tests/k6-tournaments.js` (`mass_creation`) |
| Mass registration / 10k concurrent matches | `load-tests/k6-tournaments.js` (`mass_registration`) |
| 5k concurrent chats | `load-tests/k6-chat.js` |
| 50k websocket connections | `load-tests/k6-realtime-websockets.js` |
| 100 webhooks/sec | `load-tests/k6-webhooks.js` (real HMAC-SHA512 signing, matching `_payment/providers/paystack.ts` exactly) |
| 1M notifications/day | `load-tests/k6-notifications.js` (direct sweep-worker throughput measurement, not synthetic event generation) |
| Mass withdrawals / escrow releases | `load-tests/k6-wallet.js` |

Each script targets real Edge Function endpoints with realistic request shapes (verified against the actual zod schemas each endpoint validates against, not guessed), reads all configuration from environment variables (no hardcoded target), and includes realistic ramp/burst profiles rather than a flat constant rate — matching how each scenario actually occurs in practice (e.g. tournament registration spikes right before a registration window closes, not a steady trickle).

## Design decisions worth knowing

- **k6 over an in-house script**: first-class WebSocket support (needed for the connection-count scenario), native latency-percentile reporting, JS scripting matching this team's primary language.
- **Pre-issued session tokens, not per-iteration login**: every scenario except `k6-auth.js` itself assumes a pool of already-authenticated test accounts. Logging in fresh on every iteration would make every scenario's numbers partly a measurement of GoTrue's login latency rather than the thing actually being tested.
- **Withdrawal/escrow scenario is paired with the financial verification queries**: `docs/PHASE8_5_FINANCIAL_VERIFICATION.md`'s SQL queries are the actual pass/fail criterion for `k6-wallet.js` — a load test that completes with acceptable latency but leaves an unbalanced ledger entry has *failed*, even if k6 itself reports green thresholds. This is stated explicitly in the load-test README rather than left implicit.
- **Notification scenario measures the sweep worker directly**: generating 1M real `domain_events` just to produce notification volume would pollute a staging database with fake challenges/tournaments as a side effect. Repeatedly invoking `notification-send` (using the same scheduled-job shared secret the real cron job uses) against a realistic backlog measures the actual bottleneck — `processUnhandledEvents`' own throughput — directly.
- **429s from a single test account are not a finding**: `k6-tournaments.js`'s `mass_creation` scenario deliberately pools multiple organizer-role accounts rather than driving one account past its own rate limit and reporting the resulting 429s as a "load test result" — that would be re-discovering the rate limit, not testing platform capacity.

## What a real run would need to answer, and how it's designed to answer it

- **Does the wallet ledger stay balanced under real concurrent write pressure?** → `k6-wallet.js` + the financial verification queries.
- **What's Supabase Realtime's actual connection ceiling on the target plan tier?** → `k6-realtime-websockets.js`; the ceiling itself, whatever it turns out to be, is the useful output, not a pass/fail against exactly 50,000.
- **Does the notification fan-out fix (Phase 8.5 performance review, `PHASE8_5_PERFORMANCE_REVIEW.md` finding #4) hold up under real backlog volume, not just the unit-level "1000 queries → 1" argument?** → `k6-notifications.js` against a real generated backlog.
- **Does `postBalancedEntries`' row-locking become a bottleneck under heavy concurrent load to the *same* wallet** (as opposed to load spread across many different wallets)? → `k6-wallet.js`'s latency percentiles, specifically watched for disproportionate growth, not mere presence of *some* serialization (which is correct/expected).

## Next step

Run against a real staging environment before considering this platform launch-ready under real traffic assumptions — see `load-tests/README.md`'s prerequisites and post-run checklist. Record actual results back into this document once they exist.
