-- ============================================================================
-- Migration 0023: RLS Policies — Disputes & Moderation
-- Tables: disputes, dispute_evidence, moderator_actions
-- ============================================================================

-- disputes ------------------------------------------------------------------
create policy disputes_select_participant on disputes
  for select
  using (is_dispute_participant(id));

create policy disputes_select_staff on disputes
  for select
  using (is_moderator());
  -- Any moderator, not just the assigned one, may view the queue
  -- (Business Rules §9 — round-robin/workload assignment implies moderators
  -- can see unclaimed disputes to claim them).

create policy disputes_insert_participant on disputes
  for insert
  with check (opened_by = auth.uid() and is_challenge_participant(challenge_id));

create policy disputes_update_participant_appeal on disputes
  for update
  using (is_dispute_participant(id))
  with check (is_dispute_participant(id));
  -- Restricted to appeal_filed_at only, by fn_disputes_column_guard
  -- (migration 0025) — participants may file an appeal, never set a
  -- resolution themselves.

create policy disputes_update_moderator on disputes
  for update
  using (is_moderator())
  with check (is_moderator());
  -- Resolution/rationale/status changes are further constrained by the
  -- pre-existing fn_disputes_rationale_required trigger (DB-001) and by
  -- fn_disputes_column_guard's moderator branch (migration 0025), which
  -- blocks a moderator from touching appeal_filed_at (that's the
  -- participant's action, not theirs).

-- No DELETE — disputes are a permanent record, resolved not removed.

-- dispute_evidence ----------------------------------------------------------
create policy dispute_evidence_select_visible on dispute_evidence
  for select
  using (
    exists (select 1 from disputes where id = dispute_id and is_dispute_participant(id))
    or is_moderator()
  );

create policy dispute_evidence_insert_participant on dispute_evidence
  for insert
  with check (submitted_by = auth.uid() and can_submit_proof(dispute_id));

-- No UPDATE/DELETE — immutable (enforced by DB-001 trigger; no policy needed
-- since default-deny already blocks it, but RLS is also forced so this is
-- doubly enforced).

-- moderator_actions -----------------------------------------------------
create policy moderator_actions_select_staff on moderator_actions
  for select
  using (is_admin() or is_moderator());

create policy moderator_actions_insert_staff on moderator_actions
  for insert
  with check ((is_admin() or is_moderator()) and moderator_id = auth.uid());

-- No UPDATE/DELETE — immutable accountability record.
