# Phase 6 — Security Review (CI-recovery phase)

Scope note: a full independent hostile security review ran two phases ago
(`docs/PHASE8_5_SECURITY_REVIEW.md`, `docs/PHASE8_5_FINAL_HOSTILE_REVIEW.md`)
and fixed 2 Critical CVEs, 1 High authorization bug, and multiple Medium
findings. This phase's own changes (Node version, `eslint` patch bump, CI
workflow hardening, doc fixes) touch no application security surface. This
pass verifies those prior fixes are still in place and checks the one thing
that's genuinely new since then: the dependency-tree changes from Phase 3.

## Spot-checks: prior fixes still intact

- `supabase/functions/_moderator/cases.ts`'s `assertModeratorOnDispute` still
  `throw`s (not silently `return`s) when a non-admin, non-assigned moderator
  attempts to act on a dispute — the most severe Phase 8.5 finding, confirmed
  unregressed.
- `apps/web/next.config.ts` still ships the full security header set (CSP,
  `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, HSTS,
  `Referrer-Policy`, `Permissions-Policy`).
- `supabase/functions/_wallet/repository.ts`'s `listTransactions` ledger query
  still applies `filter.cursor`, preserving correct deep pagination (the bug
  Phase 8.5's own final hostile review caught in its own earlier work).

## New in this phase: npm 11's install-script allowlist notice

`npm ci`/`npm install` now print an informational `npm warn allow-scripts`
listing packages with lifecycle scripts not yet explicitly approved
(`esbuild`, `sharp`, `unrs-resolver` — all transitive, none newly introduced
by this phase's `eslint` bump). This is npm 11's own opt-in supply-chain
feature, not something this repo configures. Verified it does **not** block
script execution (`ignore-scripts` is unset/`false`; empirically confirmed
`sharp`'s native binary loads correctly after both `npm install` and a
clean-room `npm ci`) — purely informational.

Not fixed here: adopting an explicit `npm approve-scripts` allowlist would be
a genuine, real hardening improvement (pins exactly which packages may run
install-time code, catching a future supply-chain-compromised transitive
dependency), but it's a new standing process/config, not a fix for a broken
or regressed thing — out of scope for a CI-recovery/hardening phase focused
on fixing genuine defects. Noted as a worthwhile future improvement, not a
defect blocking this release candidate.

## Conclusion

No new security findings from this phase's own changes. All previously-fixed
Critical/High findings remain fixed. One deferred, non-blocking hardening
opportunity noted above.
