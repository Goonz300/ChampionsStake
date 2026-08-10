# Phase 8.5 — Performance Review

Scoped to what Phase 7/8's own review (`docs/PHASE7_8_PERFORMANCE_REVIEW.md`) and this phase's Database Review (`docs/PHASE8_5_DATABASE_REVIEW.md`) hadn't already covered: frontend rendering, N+1 patterns in older subsystems, notification/chat throughput, older AI modules, memory/large-dataset loading, and caching.

## Fixed this phase

1. **`_wallet/repository.ts` `listTransactions`**: fetched *every* `wallet_ledger` row for a wallet, unbounded, regardless of the requested page size, just to build a transaction-ID set. A long-lived wallet paid full-history cost on every history view. Fixed: date-range filters (when provided) now apply to this query too; a generous newest-first safety-valve limit (2000) caps the fully-unbounded case.

2. **`_ai/fraud-detection.ts` `listFraudFlags`**: no `.limit()` at all when `status` was omitted — `fraud_flags` accumulates monotonically as scheduled sweeps run, so this grew worse every day of the platform's life. Fixed with a default `limit = 200`.

3. **`_realtime/notifications.ts` duplicate preference queries**: `isCategoryEnabled` and `isEmailChannelEnabled` each independently queried the same `user_preferences` row per recipient — two round trips to read one row twice. Merged into one `getNotificationChannelPreferences` call; behavior unchanged (push flag still gates the in-app insert + push send, email flag still gates only the email enqueue).

4. **`_realtime/delivery.ts` duplicate template rendering**: `renderTemplate` (a `notification_templates` query) was called once per recipient inside *both* `sendPushNotification` and `enqueueEmailNotification` — for one event with N recipients, that's 2N identical renders of content that never varies within that event (only `userId` varies, not `eventType`/`payload`). Fixed: `notifications.ts` now renders once per event and passes the result into both delivery functions for every recipient. A 500-participant tournament-completion event previously issued ~1000 template queries; now issues 1.

5. **`_wallet/reconciliation.ts`**: the 5 per-account-type `fn_wallet_balance` RPC calls per wallet were fully sequential — for the 100,000-wallet sweep this function's own header comment names as its design target, that's ~500,000 serialized round trips. Fixed with `Promise.all` across the 5 independent checks per wallet (same total call count, ~5x less wall-clock time; each check is independent so concurrency changes nothing about correctness).

6. **Frontend sequential waterfalls**: `tournaments/[id]`, `leagues/[id]`, and `teams/[id]` each issued 2-3 independent Supabase queries as sequential `await`s where nothing in the second query depended on the first's result. Converted to `Promise.all`. (`settings/page.tsx` already did this correctly — the pattern existed in the codebase, just wasn't applied consistently.)

7. **Unbounded analytics scans**: `_ai/analytics-engine.ts` (`forecastRevenue`, `forecastFraud`, `computePlayerLtv`, `platformHealth`'s dispute-status query) and `_admin/analytics.ts` (`userGrowth`, `challengeVolume`, `tournamentVolume`, `revenue`, `disputeStatistics`) all reduce a row-level fetch to a sum/count in JS with no independent cap — either no `.limit()` at all, or a limit implicitly bounded only by a caller-supplied `days` window. Added a shared `ANALYTICS_SCAN_LIMIT` (50,000) safety valve to each — this changes worst-case behavior only; realistic date windows keep normal-case results far below it.

## Investigated, not fixed — deliberate scope decisions

- **`_realtime/chat.ts` `markSeen`**: fetches every message in a challenge up to the target message with no limit, then does an unconditional `message_receipts` upsert per message (even already-seen ones) on every chat-open. Real finding, but the correct fix (filter to unseen messages first, batch the upsert) is a genuine logic change to a chat read-receipt flow, not a mechanical query-shape fix — judged to need more careful behavioral verification than this pass's remaining budget covers. Flagged for a follow-up pass.
- **No caching layer anywhere** (confirmed: zero Next.js cache directives, zero `loading.tsx`/streaming boundaries, `Cache-Control: no-store` set platform-wide on every Edge Function response, Redis used exclusively for rate-limit counters). **Not a defect** for most of this app's surface: every page is personalized, auth-gated, and financially sensitive (dashboards, wallets, tournament state) — caching shared/stale data across users would be actively dangerous for a real-money platform, and the explicit `no-store` default is a deliberate, correct choice for that reason, not an oversight. Left as-is.
- **4 sequential auth-server round trips per request** (`getUser()` in middleware, up to 2 more MFA calls in middleware, then `getUser()` again in every page's own `createClient()`): re-verifying the session server-side per page is Supabase's own documented safe pattern (never trust a forwarded header as proof of auth) — removing it would be a security regression, not a performance fix. Left as-is, documented here so the cost is visible rather than invisible.
- **Maintenance-mode flag queried on every request in middleware**: a real, small, per-request cost, but an in-memory cache in a serverless/Edge Runtime context has no reliable cross-invocation memory to cache into, and this environment has no live deployment to verify a caching approach actually works correctly at runtime. Documented as a candidate for a short-TTL cache once a real edge/runtime environment exists to test against.

## Validation

All fixes re-validated with the full pipeline (`deno fmt/lint/check/test` — 212 passed; `npm run format:check/lint/typecheck/test` — 194 passed; `npm run build`) — zero regressions.
