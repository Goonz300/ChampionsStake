# Phase 8.5 — Maintenance Guide

Routine, non-urgent upkeep — distinct from `docs/PHASE8_5_OPERATIONS_MANUAL.md`'s recurring operational checks and `docs/PHASE8_5_RUNBOOKS.md`'s incident-driven procedures.

## Dependency updates

- **Frontend**: `npm outdated --workspace=apps/web` periodically; `npm audit --omit=dev` for vulnerabilities specifically. This phase's approach is the model: prefer the *minimal* version bump that closes a known issue over jumping to latest, especially for anything touching auth (`@supabase/supabase-js`/`@supabase/ssr`) where no live environment may exist to fully regression-verify a large jump. Major-version framework bumps (like the deferred `next@16` migration) deserve their own dedicated pass with a real regression-testing budget, not a routine maintenance commit.
- **Backend**: `deno.json`'s `imports` map pins versions loosely (`@supabase/supabase-js@2`, `postgres@3` — major-version-pinned, floating within it) except `zod`/`@std/assert` (exact-pinned). Periodically check `deno.lock`'s actually-resolved versions aren't stale.

## Migration hygiene

No cleanup needed by design — migrations are additive and permanent, this is expected and correct (107 files is not itself a problem). The only maintenance task: keep adding paired `.down.sql` rollbacks for every new migration, and periodically re-verify no gaps exist (`docs/PHASE8_5_DATABASE_REVIEW.md`'s verification method — cross-reference migration filenames against rollback filenames).

## Documentation staleness

This phase found and fixed one real instance (`docs/TOURNAMENT-001-deliverable.md` claiming double-elim/Swiss/round-robin were unimplemented, long after Phase 8 implemented them) and a stale migration count in the root `README.md`. **Periodic check**: when a phase doc makes a definitive claim about what is/isn't implemented, and a later phase changes that, the later phase should update the earlier doc's claim (with an "Update, superseding the above" note, not a silent edit) rather than leaving two docs contradicting each other for a future reader to discover by accident.

## Test coverage gaps to close opportunistically

`_moderator/` and `_admin/` had zero test files before this phase (both self-described "security-critical" in their own code comments); this phase added exactly one test file (`_moderator/authorization-heuristics.test.ts`, for the bug it found and fixed) but did not achieve full coverage of either directory — that was judged out of scope for a single hardening pass. When touching either directory for any reason going forward, adding a test for the function being touched is a reasonable, low-cost way to close this gap incrementally rather than needing a dedicated future initiative.

## Load test re-runs

`load-tests/` (Step 7) should be re-run periodically against staging, not just once before initial launch — as real usage patterns emerge, update the scripts' ramp profiles and target rates to match actual observed traffic shapes rather than the brief's original estimated targets.

## Reviewing accepted-risk items

`docs/PHASE8_5_PRODUCTION_CHECKLIST.md`'s "known, accepted gaps" list (escrow timeout, tournament-suspension bracket handling, `moderator_actions` dead schema, `next`-major-version CVEs) should be revisited periodically, not launched-with-and-forgotten — each was deliberately deferred as out of this phase's scope, not judged permanently acceptable. A reasonable cadence: review this list at the start of each future planning cycle and decide explicitly whether each item is still acceptable to defer.

## Secret rotation

No automated rotation exists for any secret (see `docs/PHASE8_5_SECURITY_GUIDE.md`). Establish an owner and cadence before this becomes a "we've never rotated the service-role key" situation — the service-role key and the Paystack secret key are the two highest-value targets to prioritize.
