-- ============================================================================
-- Migration 0025: Security Triggers
--
-- Two categories:
-- (A) Column-level guards — Postgres RLS is row-level only, so wherever a
--     policy in 0018-0024 says "restricted to column X" in a comment, the
--     actual column restriction is enforced here.
-- (B) Security event audit mirrors — writes to audit_logs when a
--     security-relevant change happens, so Step 8's monitoring requirement
--     has real data to alert on.
--
-- HONESTY NOTE on Step 8 ("log unauthorized access attempts / RLS
-- violations"): Postgres does not invoke triggers on a denied SELECT — a
-- restrictive RLS policy simply filters the row out of the result set
-- silently, with no hook available at the database layer to observe that a
-- row was hidden. For INSERT/UPDATE/DELETE, a WITH CHECK failure raises a
-- generic "new row violates row-level security policy" error directly to
-- the caller; no trigger fires either, since the rejection happens as part
-- of the policy check itself. Genuine logging of "user X tried to access
-- row Y and was denied" therefore has to happen at the application/Edge
-- Function layer (catching the Postgres error and logging it there), not
-- inside the database. This migration logs the *security-relevant changes
-- that did succeed* (status changes, dispute resolutions, admin actions);
-- it does not — and structurally cannot — log denied attempts.
-- ============================================================================

-- (A) Column-level guards ----------------------------------------------------

create or replace function fn_profiles_self_update_guard()
returns trigger
language plpgsql
as $$
begin
  if is_admin() or is_moderator() then
    return new; -- staff path covered by profiles_update_staff policy instead
  end if;

  if new.role is distinct from old.role
     or new.status is distinct from old.status
     or new.kyc_status is distinct from old.kyc_status
     or new.kyc_provider_ref is distinct from old.kyc_provider_ref
     or new.trust_score is distinct from old.trust_score
     or new.completion_rate is distinct from old.completion_rate
     or new.suspended_at is distinct from old.suspended_at
     or new.suspended_reason_code is distinct from old.suspended_reason_code
     or new.closed_at is distinct from old.closed_at
     or new.email_verified_at is distinct from old.email_verified_at
  then
    raise exception
      'Self-service profile updates may only change display_name, avatar_url, and country_code.';
  end if;

  return new;
end;
$$;

create trigger trg_profiles_self_update_guard
  before update on profiles
  for each row execute function fn_profiles_self_update_guard();

create or replace function fn_messages_seen_by_only_guard()
returns trigger
language plpgsql
as $$
begin
  if new.challenge_id is distinct from old.challenge_id
     or new.sender_id is distinct from old.sender_id
     or new.type is distinct from old.type
     or new.content is distinct from old.content
     or new.media_url is distinct from old.media_url
     or new.created_at is distinct from old.created_at
  then
    raise exception 'challenge_messages may only be updated to change seen_by.';
  end if;

  return new;
end;
$$;

create trigger trg_messages_seen_by_only_guard
  before update on challenge_messages
  for each row execute function fn_messages_seen_by_only_guard();

create or replace function fn_notifications_read_status_only_guard()
returns trigger
language plpgsql
as $$
begin
  if new.user_id is distinct from old.user_id
     or new.type is distinct from old.type
     or new.payload is distinct from old.payload
     or new.created_at is distinct from old.created_at
  then
    raise exception 'notifications may only be updated to change status/read_at.';
  end if;

  return new;
end;
$$;

create trigger trg_notifications_read_status_only_guard
  before update on notifications
  for each row execute function fn_notifications_read_status_only_guard();

create or replace function fn_disputes_column_guard()
returns trigger
language plpgsql
as $$
begin
  if is_moderator() then
    -- Moderator/admin path: may set resolution fields, never the
    -- participant's own appeal_filed_at.
    if new.appeal_filed_at is distinct from old.appeal_filed_at then
      raise exception 'Only the disputing participant may file an appeal (appeal_filed_at).';
    end if;
    return new;
  else
    -- Participant path: may only file an appeal, nothing else.
    if new.status is distinct from old.status
       or new.resolution is distinct from old.resolution
       or new.resolution_rationale is distinct from old.resolution_rationale
       or new.assigned_moderator_id is distinct from old.assigned_moderator_id
       or new.decided_at is distinct from old.decided_at
       or new.appeal_decided_at is distinct from old.appeal_decided_at
       or new.appeal_decided_by is distinct from old.appeal_decided_by
    then
      raise exception 'Participants may only file an appeal (appeal_filed_at), not change dispute resolution fields.';
    end if;
    return new;
  end if;
end;
$$;

create trigger trg_disputes_column_guard
  before update on disputes
  for each row execute function fn_disputes_column_guard();

create or replace function fn_friends_status_transition_guard()
returns trigger
language plpgsql
as $$
begin
  if new.status = old.status then
    return new;
  end if;

  if auth.uid() = new.addressee_id and new.status in ('accepted', 'declined', 'blocked') then
    return new;
  elsif auth.uid() = new.requester_id and new.status = 'blocked' then
    return new;
  else
    raise exception
      'Invalid friend-request status transition for the current user (only the addressee may accept/decline/block; the requester may only block).';
  end if;
end;
$$;

create trigger trg_friends_status_transition_guard
  before update on friends
  for each row execute function fn_friends_status_transition_guard();

create or replace function fn_feature_flags_dual_approval_guard()
returns trigger
language plpgsql
as $$
begin
  if new.requires_dual_approval and new.enabled is distinct from old.enabled then
    if old.pending_approval_by is null then
      -- First admin proposes the change: record the proposer, do not flip
      -- `enabled` yet.
      new.pending_approval_by := auth.uid();
      new.enabled := old.enabled;
    elsif old.pending_approval_by = auth.uid() then
      raise exception
        'Feature flag "%" requires a DIFFERENT administrator to confirm this change (four-eyes principle, Business Rules §11).',
        old.key;
    else
      -- A different admin confirms: allow the flip, clear the pending marker.
      new.pending_approval_by := null;
      new.updated_by := auth.uid();
    end if;
  end if;

  return new;
end;
$$;

create trigger trg_feature_flags_dual_approval_guard
  before update on feature_flags
  for each row execute function fn_feature_flags_dual_approval_guard();

-- (B) Security event audit mirrors ------------------------------------------

create or replace function fn_audit_profile_status_change()
returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from old.status then
    perform log_security_event(
      'AccountStatusChanged',
      'profiles',
      new.id::text,
      jsonb_build_object('old_status', old.status, 'new_status', new.status)
    );
  end if;
  return new;
end;
$$;

create trigger trg_audit_profile_status_change
  after update on profiles
  for each row execute function fn_audit_profile_status_change();

create or replace function fn_audit_dispute_resolution()
returns trigger
language plpgsql
as $$
begin
  if new.resolution is distinct from old.resolution and new.resolution is not null then
    perform log_security_event(
      'ModeratorDecisionRecorded',
      'disputes',
      new.id::text,
      jsonb_build_object('resolution', new.resolution, 'moderator_id', new.assigned_moderator_id)
    );
  end if;
  return new;
end;
$$;

create trigger trg_audit_dispute_resolution
  after update on disputes
  for each row execute function fn_audit_dispute_resolution();

create or replace function fn_audit_feature_flag_change()
returns trigger
language plpgsql
as $$
begin
  if new.enabled is distinct from old.enabled then
    perform log_security_event(
      'FeatureFlagToggled',
      'feature_flags',
      new.key,
      jsonb_build_object('old_enabled', old.enabled, 'new_enabled', new.enabled)
    );
  end if;
  return new;
end;
$$;

create trigger trg_audit_feature_flag_change
  after update on feature_flags
  for each row execute function fn_audit_feature_flag_change();

create or replace function fn_audit_moderator_action()
returns trigger
language plpgsql
as $$
begin
  perform fn_write_audit_log(
    new.moderator_id,
    case when is_admin() then 'administrator' else 'moderator' end::actor_type,
    new.action_type,
    'moderation'::audit_action_category,
    new.target_table,
    new.target_id::text,
    jsonb_build_object('rationale', new.rationale, 'dispute_id', new.dispute_id, 'challenge_id', new.challenge_id)
  );
  return new;
end;
$$;

create trigger trg_audit_moderator_action
  after insert on moderator_actions
  for each row execute function fn_audit_moderator_action();

create or replace function fn_audit_wallet_adjustment()
returns trigger
language plpgsql
as $$
begin
  if new.type = 'adjustment' then
    perform fn_write_audit_log(
      new.initiated_by,
      'administrator'::actor_type,
      'AdminWalletAdjustment',
      'financial'::audit_action_category,
      'wallet_transactions',
      new.id::text,
      jsonb_build_object('wallet_id', new.wallet_id, 'amount_cents', new.amount_cents)
    );
  end if;
  return new;
end;
$$;

create trigger trg_audit_wallet_adjustment
  after insert on wallet_transactions
  for each row execute function fn_audit_wallet_adjustment();
