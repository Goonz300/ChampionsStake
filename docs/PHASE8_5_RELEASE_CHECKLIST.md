# Phase 8.5 — Release Checklist

The standard process this phase itself followed, codified for every future change of comparable scope — a feature milestone, a hardening pass, or a significant bug-fix batch. For a single small fix, use judgment about which steps genuinely apply.

## Before starting

- [ ] Confirm the branch is up to date with `main`/the target branch.
- [ ] Read the relevant subsystem's design doc first (`docs/PHASE8_5_ARCHITECTURE_GUIDE.md`'s "never duplicate a primitive" check).

## During implementation

- [ ] Every bug fix includes a regression test that would have caught the original bug (see `_moderator/authorization-heuristics.test.ts` for the template: pin the exact scenario the bug got wrong, not just "the happy path still works").
- [ ] Every new migration is additive, with a paired `.down.sql` rollback.
- [ ] Every new Edge Function has a `rateLimit` config.
- [ ] No new architecture/framework/major dependency added without a documented, deliberate reason (this phase's own `next`/`vitest` version bumps are the model: minimal necessary change, verified compatible, not a speculative upgrade).
- [ ] Commit after every logical milestone, not as one giant diff at the end — makes review and, if needed, targeted rollback possible.

## Validation (every commit, not just the final one)

Backend:
```bash
deno fmt --check supabase/functions/
deno lint supabase/functions/
deno check supabase/functions/**/*.ts
deno test --allow-env supabase/functions/
```

Frontend:
```bash
npm run format:check --workspace=apps/web
npm run lint --workspace=apps/web
npm run typecheck --workspace=apps/web
npm run test --workspace=apps/web
npm run build --workspace=apps/web
```

All of the above now run in CI (`.github/workflows/ci.yml`, fixed this phase to actually execute the test suites) — but running them locally before pushing catches issues faster than waiting for CI.

## Hostile review (for anything security-relevant)

- [ ] Assume the code was written by a team owing it no benefit of the doubt.
- [ ] For every finding: can you articulate a concrete exploit sequence (attacker steps → impact)? If not, it's Informational at most, not a reportable finding.
- [ ] Classify Critical/High/Medium/Low/Informational honestly.
- [ ] Fix every Critical/High/Medium. Leave Low/Informational only if genuinely an intentional trade-off, documented as such.
- [ ] Re-run full validation after every fix.

## Merge gate — all of these, not most of them

- [ ] Every planned item for this change is actually complete (not "mostly done").
- [ ] No Critical issues remain.
- [ ] No High issues remain.
- [ ] No Medium issues remain (or each remaining one is explicitly documented as an accepted, deliberate trade-off — not silently dropped).
- [ ] Validation fully green (both runtimes).
- [ ] `git status` clean.
- [ ] Branch synced with origin.
- [ ] A fast-forward or clean merge into the target branch is possible.
- [ ] Target branch builds successfully after the merge (verify, don't assume).

**If any condition fails: stop. Produce a blocker report. Do not merge.** This is not a formality — see `docs/PHASE8_5_PRODUCTION_CHECKLIST.md` for what "not merging" actually means in practice for a real launch decision.

## After merge

- [ ] Verify local and remote commit hashes match.
- [ ] Delete the feature branch (locally and remotely) once merged, unless there's a specific reason to keep it.
- [ ] Update any documentation that referenced the old state as current (a doc claiming something is "not yet implemented" that just got implemented is now actively misleading — this phase found and fixed exactly this class of staleness in `docs/TOURNAMENT-001-deliverable.md`).
