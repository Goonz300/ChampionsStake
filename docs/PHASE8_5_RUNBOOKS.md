# Phase 8.5 — Runbooks

Step-by-step procedures for specific operational scenarios. For symptom-triaged incident response, see `docs/PHASE8_5_INCIDENT_RESPONSE_GUIDE.md`; these runbooks are the detailed "how" once you've identified which one you need.

## Runbook: Investigate and resolve a reconciliation mismatch

1. `select * from wallet_reconciliation_runs order by started_at desc limit 1;` — get the run id and mismatch count.
2. Identify the affected wallet(s): the frozen-wallet list is derivable from `wallets.status = 'frozen'` combined with a recent `WalletFrozen`-category `audit_logs` entry (`recordAudit` is called by `freezeWallet`, reused from `_wallet/service.ts`).
3. For each affected wallet, run `docs/PHASE8_5_FINANCIAL_VERIFICATION.md`'s cached-vs-ledger-drift query scoped to that wallet id.
4. Pull the wallet's full ledger history: `select * from wallet_ledger where wallet_id = '<id>' order by created_at asc;` — look for the specific entry (or absence of an entry) that explains the drift.
5. Cross-reference `wallet_transactions` for the same wallet — any transaction with a status inconsistent with its ledger legs (e.g. `completed` but a leg amount that doesn't match)?
6. Determine root cause (see `PHASE8_5_INCIDENT_RESPONSE_GUIDE.md` §1) before remediating.
7. Remediate via a new, explicit, audited ledger entry — never edit existing rows (blocked by `fn_prevent_mutation` anyway).
8. Unfreeze via `admin-wallets`, with a `recordAudit` entry explaining the resolution.
9. Re-run the reconciliation check for that wallet to confirm it's now clean.

## Runbook: Manually advance a stuck tournament round

(Context: `docs/PHASE8_5_TOURNAMENT_CORRECTNESS.md`'s documented gap — a suspended participant's match gets cancelled without tournament-bracket awareness.)

1. Identify the stuck match: `select * from tournament_matches tm join challenges c on c.id = tm.challenge_id where tm.round_id = '<round_id>' and c.status = 'cancelled';`
2. Identify the surviving opponent (the other `challenge_participants` row for that challenge).
3. Decide the resolution: advance the surviving opponent as a bye (consistent with how byes are already handled elsewhere in `bracket.ts`), or void the entire match per organizer discretion.
4. Apply via the existing tournament admin/organizer tooling — there is no automated path for this scenario yet; this is a manual data correction until a future milestone builds one.
5. Verify the round can now progress normally (next round generation, if this was the last pending match in the round).

## Runbook: Rotate a secret

1. Identify which config module owns it (`supabase/functions/_shared/config/index.ts` for backend secrets, `apps/web/lib/env.ts` for frontend) — see `docs/PHASE8_5_INFRASTRUCTURE_GUIDE.md`'s full env var reference.
2. Generate the new secret value with the provider (Paystack, Resend, Upstash, etc.) — do not deactivate the old one until the new one is confirmed working.
3. Update the value in the deployment environment (Supabase project settings for Edge Function secrets, Vercel environment variables for the frontend, Vault for cron-job shared secrets — `select vault.update_secret(...)`).
4. For cron-job secrets specifically: confirm the `pg_net.http_post` call in the relevant migration reads the secret by name from Vault (it does, by convention) rather than having it hardcoded — a rotation should require no code change, only a Vault update.
5. Verify: trigger one real call through the rotated path (a login for CAPTCHA, a test webhook for Paystack, a test rate-limit check for Upstash) and confirm success before considering the rotation complete.
6. Deactivate the old secret with the provider once confirmed.

## Runbook: Add a new Edge Function

1. Check `docs/PHASE8_5_ARCHITECTURE_GUIDE.md`'s "never duplicate a primitive" principle first — does existing shared logic already do most of what's needed?
2. Create `supabase/functions/<name>/index.ts` using `withEdgeFunction` (auth, rate limit, error handling) — copy an existing function's shape (e.g. `team-manage` for a `?view=`/`action`-consolidated function) rather than inventing a new composition pattern.
3. Business logic goes in a `_module/` directory, imported by the thin `index.ts` — never inline complex logic directly in the route handler.
4. Add a `rateLimit` config — every function in this codebase has one (verified, `docs/PHASE7_8_PERFORMANCE_REVIEW.md`); there is no function-level exemption from this convention except the three explicitly-documented exceptions (`health`, `storage-cleanup`, `payment-webhook`).
5. If it's scheduled: follow the `pg_cron` + `pg_net.http_post` + Vault-secret pattern from any existing scheduler migration (e.g. migration `0102`), and add its cadence to `docs/PHASE8_5_INFRASTRUCTURE_GUIDE.md`'s cron table.
6. Run the full validation pipeline (`deno fmt/lint/check/test`) before committing — see `docs/PHASE8_5_RELEASE_CHECKLIST.md`.

## Runbook: Investigate a suspicious fraud flag

1. `GET moderator-dashboard?view=analytics` or `admin-security?view=fraud_flags&status=open` for the current queue.
2. Check `factors` (jsonb) on the flag row — every fraud/risk signal in this codebase stores its explainable inputs, not just a score (established convention since Phase 7's Trust Engine v2).
3. Cross-reference the flagged account's `trust_score_history` and `risk_scores` for corroborating or contradicting signals.
4. For a `multi_account`/device-farming flag specifically: check `devices.device_fingerprint` overlap — remember the documented false-positive source (shared household/NAT IP with a coarse `/24` match, per `docs/INCIDENT_RESPONSE_GUIDE.md` §2).
5. Resolve via `admin-security`'s flag-review action, recording the actual determination (confirmed fraud / false positive) — this feeds back into future heuristic tuning, so an unreviewed or lazily-reviewed flag degrades the whole system's signal quality over time.
