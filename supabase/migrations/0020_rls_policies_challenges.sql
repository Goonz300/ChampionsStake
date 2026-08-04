-- ============================================================================
-- Migration 0020: RLS Policies — Games, Platforms, Regions, Challenges
-- ============================================================================

-- Lookup tables: public read, admin-only write ------------------------------
create policy platforms_select_all on platforms for select using (true);
create policy platforms_write_admin on platforms for all using (is_admin()) with check (is_admin());

create policy regions_select_all on regions for select using (true);
create policy regions_write_admin on regions for all using (is_admin()) with check (is_admin());

create policy games_select_all on games for select using (true);
create policy games_write_admin on games for all using (is_admin()) with check (is_admin());

-- challenges --------------------------------------------------------------
create policy challenges_select_public on challenges
  for select
  using (visibility = 'public');

create policy challenges_select_friends on challenges
  for select
  using (
    visibility = 'friends'
    and exists (
      select 1 from friends
      where status = 'accepted'
        and (
          (requester_id = creator_id and addressee_id = auth.uid())
          or
          (addressee_id = creator_id and requester_id = auth.uid())
        )
    )
  );

create policy challenges_select_participant on challenges
  for select
  using (is_challenge_participant(id));

create policy challenges_select_staff on challenges
  for select
  using (is_admin() or is_moderator());

-- INSERT: a user may only ever create a challenge as themselves. Business
-- rule eligibility (email verified, KYC-or-under-threshold, Business Rules
-- §2) is validated by the API layer before this INSERT is issued — RLS
-- enforces ownership, not the full eligibility rule set, since some of those
-- checks (rolling stake totals) are not cheaply expressible as a row filter.
create policy challenges_insert_own on challenges
  for insert
  with check (creator_id = auth.uid() and status = 'draft');

-- UPDATE: creators may edit ONLY while still in draft (Business Rules §3 —
-- "editing" is blocked in every non-terminal state; the only genuinely
-- free-form edit window is pre-publish). Every other transition (publish,
-- accept, ready, declare-winner, release, dispute, cancel, rematch) is
-- performed by an Edge Function using service_role, never a direct client
-- UPDATE — those actions require coordinated escrow/notification/chat side
-- effects that a bare table UPDATE cannot safely perform (Business Rules §1,
-- Server Authority / Zero Trust Client principle).
create policy challenges_update_draft_owner on challenges
  for update
  using (creator_id = auth.uid() and status = 'draft')
  with check (creator_id = auth.uid() and status = 'draft');

create policy challenges_update_staff on challenges
  for update
  using (is_admin() or is_moderator())
  with check (is_admin() or is_moderator());

-- No DELETE policy: challenges are cancelled/expired/archived, never deleted.

-- challenge_participants ------------------------------------------------
create policy challenge_participants_select_visible on challenge_participants
  for select
  using (
    user_id = auth.uid()
    or is_challenge_participant(challenge_id)
    or is_moderator()
    or exists (select 1 from challenges where id = challenge_id and visibility = 'public')
  );
-- No client INSERT/UPDATE/DELETE — participant rows are created by the
-- accept-challenge Edge Function (service_role).

-- challenge_events --------------------------------------------------------
create policy challenge_events_select_participant on challenge_events
  for select
  using (is_challenge_participant(challenge_id) or is_moderator());
-- No client writes — this is a system-generated audit trail.

-- challenge_messages ------------------------------------------------------
create policy challenge_messages_select_participant on challenge_messages
  for select
  using (
    is_challenge_participant(challenge_id)
    or (is_moderator() and exists (select 1 from disputes where challenge_id = challenge_messages.challenge_id))
  );

create policy challenge_messages_insert_participant on challenge_messages
  for insert
  with check (
    is_challenge_participant(challenge_id)
    and (sender_id = auth.uid() or sender_id is null)
  );
  -- The read-only-after-completion rule is enforced by the
  -- fn_challenge_messages_read_only_guard trigger from DB-001 — RLS handles
  -- *who* may attempt to insert, the trigger handles *when* it's still allowed.

create policy challenge_messages_update_seen_by on challenge_messages
  for update
  using (is_challenge_participant(challenge_id))
  with check (is_challenge_participant(challenge_id));
  -- Restricted to only touching the seen_by column by
  -- fn_messages_seen_by_only_guard (migration 0025) — RLS alone can't
  -- restrict which column an UPDATE modifies.

-- No DELETE — chat history is retained per Business Rules §8.

-- challenge_attachments -----------------------------------------------------
create policy challenge_attachments_select_participant on challenge_attachments
  for select
  using (is_challenge_participant(challenge_id) or is_moderator());

create policy challenge_attachments_insert_participant on challenge_attachments
  for insert
  with check (is_challenge_participant(challenge_id) and uploaded_by = auth.uid());

-- No UPDATE/DELETE — evidence is immutable once uploaded ("moderators may
-- review evidence but not alter it").
