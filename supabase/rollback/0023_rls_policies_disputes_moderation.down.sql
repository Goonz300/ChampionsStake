-- Rollback 0023: RLS Policies — Disputes & Moderation
drop policy if exists moderator_actions_insert_staff on moderator_actions;
drop policy if exists moderator_actions_select_staff on moderator_actions;
drop policy if exists dispute_evidence_insert_participant on dispute_evidence;
drop policy if exists dispute_evidence_select_visible on dispute_evidence;
drop policy if exists disputes_update_moderator on disputes;
drop policy if exists disputes_update_participant_appeal on disputes;
drop policy if exists disputes_insert_participant on disputes;
drop policy if exists disputes_select_staff on disputes;
drop policy if exists disputes_select_participant on disputes;
