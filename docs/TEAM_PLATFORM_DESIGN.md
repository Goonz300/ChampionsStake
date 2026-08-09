# Team Platform Design (Phase 8 M2)

## 1. Architecture

One `teams` table with a `team_type` discriminator (`'team' | 'organization' | 'clan'`) rather than three separate schemas — the brief listed Teams/Organizations/Clans as bullets under a single milestone without defining a structural distinction between them, so inventing three parallel schemas would have been speculative complexity. `parent_organization_id` (self-referencing, nullable) lets an organization group multiple teams without a second table.

Team-scoped permissions (owner/captain-only actions) are plain application-code checks against `team_members.role`, not a new authz mechanism — the same pattern this codebase already uses for `dispute.assigned_moderator_id` or challenge participancy.

## 2. Schema (migration 0094)

- `teams` — `id, name, slug (unique), description, team_type, parent_organization_id, owner_id, avatar_url`
- `team_members` — `team_id, user_id, role ('owner'|'captain'|'member'), joined_at, left_at`. Departed members are never deleted (`left_at` set instead) — this **is** "team history" for membership, without a separate history table. A partial unique index (`team_id, user_id) where left_at is null`) allows a user to hold only one active membership per team but permits rejoining after leaving (a new row, not resurrecting the old one).
- `team_invitations` — same shape as `tournament_invitations` (migration 0100), `status` lifecycle `pending → accepted|declined`.

## 3. Service layer (`_team/service.ts`, `_team/repository.ts`, `_team/slug.ts`)

`slug.ts` holds the pure `slugify()` function in its own file — a `getServiceRoleClient()` call at the top of `service.ts` (needed for every other export) would otherwise throw immediately in a DB-client-free test environment and poison any test importing the module, even transitively. This is the same fix applied to `_realtime/spectator.ts` later in Phase 8.

Mutations: `createTeam`, `inviteMember`, `respondToInvitation` (atomic `UPDATE … WHERE status='pending' RETURNING`, preventing a double-accept race), `revokeInvitation`, `leaveTeam`, `removeMember`, `transferOwnership`, `promoteToCaptain`. `transferOwnership` is the one genuinely multi-row-atomic operation (demote old owner to captain, promote new owner, update `teams.owner_id`) and runs inside `withTransaction`.

**Hostile-review fix (see `PHASE7_8_SECURITY_REVIEW.md`, Critical #1):** `transferOwnership`'s row-locked claim query originally verified only that the caller was an *active member*, not that they held `role='owner'` — any member could hijack a team. Fixed by adding `and role = 'owner'` to the locked `SELECT`.

## 4. Reuse, not duplication

- `recordAudit` for every mutation (category `"team"`, added to `AuditCategory`'s TS union and the `audit_action_category` DB enum).
- `emit()` → the existing Phase 4 notification pipeline for `TeamInvitationSent`/`TeamOwnershipTransferred` (EVENT_RULES entries in `_realtime/notifications.ts`).
- No new middleware: rate limiting via the standard `withEdgeFunction({ rateLimit })` config on `team-manage`; RBAC via `requirePlayer`/manual role checks, not a new mechanism.

## 5. Edge Function (`team-manage`)

Single `?view=`/`action` consolidated function (GET: `team`, `members`, `stats`, `my_invitations`; POST: `create`, `invite`, `respond_invitation`, `revoke_invitation`, `leave`, `remove_member`, `transfer_ownership`, `promote_captain`) — matches the `admin-wallets`/`moderator-dashboard` precedent rather than one function per action.

## 6. Statistics

`getTeamStatistics` computes `memberCount`/`tournamentsEntered`/`tournamentsWon` on read from `tournament_registrations.team_id` (migration 0094) directly — no separate team-statistics table, same "compute on read" convention as every other `*Statistics` function in this codebase.

## 7. Known, stated limitation

Teams have no team-owned wallet. Season rewards for a team-based standing credit the team's *current owner's* wallet (`_league/season-service.ts`'s `getTeamOwnerWalletId`) — a documented simplification, not building shared team wallets, which is a substantially larger financial-architecture change this milestone doesn't invent. This is also why the `transferOwnership` privilege-escalation bug (fixed, see above) was rated Critical rather than merely a permissions bug: it was a direct route to redirecting a team's future reward payouts.

## 8. Verification checklist

- [x] `removeMember` refuses to remove a `role='owner'` row — the legitimate owner can't be evicted by another member
- [x] `respondToInvitation` uses an atomic claim, not read-then-write — two concurrent accepts of the same invitation can't both succeed
- [x] `transferOwnership` re-verified post-hostile-review to require `role='owner'`, inside a row-locked transaction
- [x] No DB-client top-level code in any file imported by a test (the `slug.ts` extraction)
- [ ] **Not verified in this environment**: no live Postgres, so `transferOwnership`'s transactional behavior and the invitation-accept race are verified by code reading against the exact exploit sequence, not an integration test — consistent with this codebase's existing testing boundary (DB-client-free pure functions only get direct unit tests).
