# ChampionsStake DB-002 — Security Foundation (RLS & Access Control)

## 1. Security Overview

Every one of DB-001's 29 tables now has RLS **enabled and forced** (migration 0017 — `FORCE` matters because Supabase migrations run as an owner-equivalent role, which Postgres normally exempts from RLS unless forced). Verified programmatically: all 29 tables have at least one explicit policy (§9 below) — none are left silently full-deny by accident. Default posture is deny: a table with no permissive policy for a given operation rejects that operation entirely for `anon`/`authenticated`, with `service_role` (Edge Functions only) as the sole intentional bypass.

Two Postgres-native limitations shaped the design, both handled explicitly rather than glossed over:
- **RLS is row-level, not column-level.** Anywhere the brief implied "this column is restricted," I either (a) added a `security invoker`-bypassing view exposing only safe columns (`v_public_profiles`), or (b) added a trigger-based column guard (migration 0025) alongside the row-level policy. Both are called out inline.
- **RLS cannot log denied SELECTs**, and write-path denials raise a Postgres error rather than firing a loggable trigger. This is explained in full in migration 0025's header comment rather than papered over with triggers that would appear to do something they structurally cannot.

## 2. Role Hierarchy

| Role | Mechanism | Summary |
|---|---|---|
| Anonymous | Postgres `anon` | Public data only (games, public challenges, leaderboard via `v_public_profiles`) |
| Authenticated Player | `authenticated` + `profiles.role='player'` | Default logged-in state |
| Verified Player | above + `profiles.kyc_status='verified'` | Sub-state, checked live via `is_verified()`, not cached |
| Moderator | `authenticated` + `profiles.role='moderator'` | Dispute/void authority |
| Administrator | `authenticated` + `profiles.role='administrator'` | Superset of moderator + four-eyes financial/flag control |
| Support | `authenticated` + `profiles.role='support'` *(new enum value, justified below)* | Read-only account/ticket visibility, no financial or moderation write authority |
| System Service | Postgres `service_role` | Edge Functions only; bypasses RLS entirely (Architecture §8) |
| Future API Client | *not implemented* | Needs a schema decision (API-key/OAuth-client table) that belongs to a future Roadmap task, not improvised here |

**The one schema change in this phase:** added `'support'` to the `user_role` enum (migration 0015). Justified as a verified security issue: without it, support staff would need the full `administrator` role to do their job, directly violating this phase's least-privilege mandate. It's additive and backward-compatible — no existing row, policy, or function is affected. Postgres cannot remove an enum value cleanly, so the rollback file documents that honestly instead of pretending to reverse it.

Every privilege check (`is_admin()`, `is_moderator()`, etc.) queries `profiles` live rather than trusting a JWT claim — see the design note at the top of migration 0016 for why (a suspended admin's existing token could otherwise retain "admin" for up to 15 minutes).

## 3. JWT Claim Specification

See migration 0015 for the full table. Summary: `user_id` (via `auth.uid()`) is the one trusted identity claim; `app_role`/`verified`/`kyc_status`/`trust_score`/`feature_flags` are injected by `custom_access_token_hook()` for **client-side UI hints only** and are never read by any RLS policy or helper function. Wiring the hook into `supabase/config.toml` is an operational step documented inline (not expressible in SQL).

## 4–5. RLS Policies & Storage Policies

All in migrations 0018–0026. Highlights:
- **Wallets/ledger/escrow (0019):** zero INSERT/UPDATE/DELETE policies for `authenticated`/`anon` on any of the 5 financial tables — only `service_role` (Edge Functions) can write. Column-level `REVOKE` on `wallets.available_cents`/`escrowed_cents` adds a second layer beneath DB-001's existing trigger guard.
- **Challenges (0020):** public/friends/participant visibility tiers; client `UPDATE` is allowed **only** while `status='draft'` — every state transition (publish, accept, ready, declare-winner, release, dispute) goes through Edge Functions, never a direct client `UPDATE`, per Business Rules §1 (Server Authority).
- **Profiles (0018):** base table restricted to self + staff; a `v_public_profiles` view (bypassing base-table RLS by view-owner privilege) is the only sanctioned path for browsing other users' safe fields.
- **Disputes (0023 + 0025):** RLS gates *who* can attempt an update (participant or moderator); a trigger (`fn_disputes_column_guard`) gates *which columns* — participants can only file an appeal, moderators can only set resolution fields, and neither can touch the other's lane.
- **Feature flags (0024 + 0025):** a genuine two-transaction four-eyes mechanism — the first admin's toggle records `pending_approval_by` without flipping the flag; a second, different admin's confirming update actually flips it. The same admin attempting to confirm their own change is rejected with a clear error.
- **Storage (0026):** created the 5 buckets (needed to write meaningful policies — noted as a minor scope pull-forward from Roadmap Phase 4, not a ChampionsStake schema change) with path-convention-based ownership checks (`avatars/{user_id}/...`, `chat-media/{challenge_id}/...`, `proofs/{dispute_id}/...`, `kyc/{user_id}/...`, `tournament-assets/{tournament_id}/...`), reusing the same helper functions as the table policies.

## 6. Security Helper Functions

13 functions in migration 0016 (`is_admin`, `is_moderator`, `is_support`, `is_verified`, `is_active_player`, `owns_wallet`, `owns_challenge`, `is_challenge_participant`, `is_dispute_participant`, `is_assigned_moderator`, `can_submit_proof`, `can_release_escrow`, `log_security_event`), all `stable security definer`, all verified programmatically to be defined before use and to match every call site across the policy files.

## 7. Security Triggers

Two categories in migration 0025 — column-level guards (profiles self-update, chat `seen_by`, notification read-status, dispute column separation, friend-request transitions, feature-flag dual approval) and audit mirrors (account status changes, dispute resolutions, feature flag toggles, moderator actions, wallet adjustments — all writing to `audit_logs` via the shared `fn_write_audit_log`/`log_security_event` entry point).

## 8. Security Tests

`supabase/tests/security_tests.sql` — 11 tests covering every scenario the brief listed by name (anonymous denial, cross-player wallet isolation, escrow write denial, transaction delete denial, moderator/admin visibility, service_role bypass, storage upload denial), run inside a transaction that rolls back at the end so fixture data never persists.

## 9. Verification Checklist

- [x] RLS enabled + forced on all 29 DB-001 tables (programmatic check — see script output below)
- [x] Every table has at least one explicit policy (verified: zero gaps between DB-001's table list and policy-covering tables)
- [x] Every helper function referenced by a policy is defined before use (verified programmatically)
- [x] No client write policy exists on any financial table (wallets, wallet_transactions, wallet_ledger, escrow_accounts, escrow_transactions) — confirmed by manual re-read of migration 0019, zero `for insert`/`for update`/`for delete` clauses present
- [x] All new SQL files have balanced parentheses and `$$` function-body quoting (verified programmatically)
- [x] Storage buckets created with explicit MIME/size limits before their policies reference them
- [ ] **Not verified in this environment**: no live Postgres/Supabase instance was reachable (no network access in this container). The security_tests.sql suite is written to be run for real — please execute it (`psql "$DATABASE_URL" -f supabase/tests/security_tests.sql`) against a real Supabase project before treating this phase as done. A clean run (11 "PASS" notices, no exception) is the actual bar, not the static checks I could perform here.

## 10. Security Audit Summary

**Strengths:** genuine default-deny posture; financial tables have zero client write paths; state-machine transitions are structurally forced through Edge Functions rather than raw table writes; four-eyes enforcement for both wallet adjustments (DB-001) and feature flags (this phase) is implemented as real, testable trigger logic, not just a documented convention.

**Known, deliberately-scoped gaps (not silently omitted):**
1. Denied-SELECT and denied-write attempts cannot be logged at the database layer (Postgres limitation, explained in 0025) — this must be handled by the Edge Function/API layer catching and logging the Postgres error. Flagging this for whoever builds Phase 5 Edge Functions so it isn't assumed to already exist.
2. "Future API Client" role is unimplemented by design — needs its own schema (API keys/OAuth clients), which is a decision for a dedicated Roadmap task, not something to bolt on here.
3. Live execution of the RLS-enable migration and the test suite against a real database is still outstanding — see the checklist above.

## Stop point

DB-002 is complete. Per your instruction, stopping here and awaiting approval before Phase 3 (Authentication).
