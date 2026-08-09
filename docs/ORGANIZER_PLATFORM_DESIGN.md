# Organizer Platform Design (Phase 8 M6)

(Referenced from migration `0100_organizer_platform.sql` before this file existed — this is that promised design doc.)

## 1. Who can organize

Tournament creation was hard-coded admin-only prior to this phase (repository audit finding). Widened to a new admin-granted `organizer` role (`_shared/auth/roles.ts`, `UserProfile.role` union) rather than self-service for any player — a deliberate choice given real-money entry fees/prize pools and no existing fraud-apparatus track record for open self-service tournament creation. `requireOrganizer` (`_shared/permissions/index.ts`) gates `tournament-create` and every mutating action on `tournament-organize`/`league-manage`.

## 2. Schema additions (migration 0100)

Added directly to `tournaments`: `visibility ('public'|'private'|'invite_only')`, `is_recurring`, `recurrence_rule` (free text, e.g. `"weekly"` — not a full RRULE parser), `template_id`, `sponsor_name`, `sponsor_logo_url`.

- `tournament_templates` — reusable presets (`name, game_id, format, entry_fee_cents, payout_structure, visibility, is_recurring, recurrence_rule, sponsor_name, sponsor_logo_url, created_by`).
- `tournament_invitations` — same shape as `team_invitations`; required for `visibility='invite_only'` registration.

## 3. Recurring tournaments, concretely

"Recurring tournaments" is not a separate entity type — it's `spawnFromTemplate(actorId, templateId, overrides)`, called repeatedly (by an organizer, or a future scheduled job reading `recurrence_rule`) to produce each occurrence. Delegates to `createTournament` (`_tournament/workflow.ts`) for the actual insert; never duplicates that logic.

## 4. Visibility enforcement

**Cross-system integration fix** (found during the Phase 7/8 audit, not this milestone's original implementation): `tournament-browse`'s `"list"` view had zero visibility filtering — private/invite-only tournaments would have been publicly listable. Fixed with role/ownership-aware filtering in the browse query.

## 5. Financial-integrity fixes from the hostile review

Two Medium findings, both fixed — see `PHASE7_8_SECURITY_REVIEW.md`:
- **`payoutStructure` validation**: percentages were unbounded. An out-of-range structure doesn't enable theft (`postBalancedEntries` hard-rejects any unbalanced ledger request), but it permanently sticks a tournament in `prize_distribution` with every registrant's entry fee locked in escrow — a self-inflicted DoS. Bounded each value to `(0, 100]` and the sum to `<= 100` in the `create_template` zod schema.
- **`spawn_from_template` replay**: no idempotency protection, unlike `tournament-register`'s established pattern. A retried/double-clicked request created two independent draft tournaments from the same template, each independently collecting entry fees from whoever registers. Fixed with the same `Idempotency-Key` flow.

Bracket seeding itself was independently confirmed *not* exploitable by an organizer: `generateBracket` seeds strictly from `profiles.trust_score` (server-held, not writable by any Phase 8 endpoint); no request parameter anywhere in `tournament-organize`/`tournament-register` reaches bracket placement.

## 6. Organizer dashboard

`getOrganizerDashboard(organizerId)` — `reputationScore` (delegates to Phase 7 M3's `computeOrganizerReputation`, not a second reputation mechanism), `tournamentCounts` by status, `templateCount`. Consumed by `apps/web/app/(app)/organizer/page.tsx`.

**High-severity reputation-farming fix** (hostile review): `computeOrganizerReputation`'s underlying `completedBonus` previously applied in full to *any* completed tournament regardless of size — a 2-player, zero-entry-fee bracket (the platform minimum) scored identically to a large, real one, making "trusted organizer" status cheap to manufacture before running a real, higher-stakes event. Fixed with `computeTournamentScaleFactor` (diminishing-returns scaling by registration count) — see `RANKING_PLATFORM_DESIGN.md`'s sibling doc `PHASE7_8_SECURITY_REVIEW.md` for detail; the fix itself lives in `_ai/reputation-heuristics.ts` (Phase 7 module), triggered by this phase's own review.

## 7. Analytics reuse

`tournament-organize`'s `ecosystem_health`/`scheduling_adherence`/`participation`/`revenue`/`drop_off`/`quality` views delegate entirely to `_tournament/analytics.ts` (see `TOURNAMENT_ANALYTICS_DESIGN.md`) — no duplicated aggregation logic in the organizer module itself.

## 8. Verification checklist

- [x] `tournament-create`/`tournament-organize` mutations all require `requireOrganizer`
- [x] `payoutStructure` bounded at the API boundary (zod `.refine`)
- [x] `spawn_from_template` idempotency-keyed, matching `tournament-register`'s pattern
- [x] Bracket seeding confirmed to have no organizer/participant-writable input path
- [x] `tournament-browse`'s visibility filtering fixed and covers `private`/`invite_only`
- [ ] **Not verified in this environment**: no live Postgres for the idempotency-key insert race or the actual visibility-filtered query plan — verified by code reading, not integration test.
