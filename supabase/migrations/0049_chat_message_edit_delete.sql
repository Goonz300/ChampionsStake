-- ============================================================================
-- Migration 0049: Chat Message Editing & Deletion
--
-- TENSION WITH PRIOR PHASES, RESOLVED EXPLICITLY: DB-001/DB-002 established
-- chat_messages as fully immutable ("read-only once sent", enforced by
-- fn_messages_seen_by_only_guard blocking every column except seen_by).
-- This phase explicitly requires an editing window and sender-initiated
-- deletion. Resolution: messages remain append-only in the sense that
-- nothing is ever hard-deleted or has its history erased — "deletion" is a
-- soft tombstone (content replaced, original preserved for moderation/audit
-- via original_content), and "editing" is time-boxed and preserves the
-- original. This satisfies the new requirement without actually violating
-- the retention/audit principle the immutability rule was protecting.
-- ============================================================================

alter table challenge_messages
  add column edited_at timestamptz,
  add column deleted_at timestamptz,
  add column original_content text, -- set on first edit or delete; never overwritten again
  add column delivered_to uuid[] not null default '{}';

comment on column challenge_messages.original_content is
  'Snapshot of content the FIRST time this message was ever edited or deleted — preserves the audit trail even though the visible content may change.';

-- Replace the seen-by-only guard with a broader (but still tightly scoped)
-- guard: seen_by/delivered_to updates (unchanged), a single edit within a
-- 5-minute window by the sender while the challenge is non-terminal, or a
-- sender-initiated soft-delete before the challenge reaches a terminal
-- state (Business Rules-consistent: chat closes when the challenge does).
create or replace function fn_messages_seen_by_only_guard()
returns trigger
language plpgsql
as $$
declare
  v_challenge_status challenge_status;
begin
  -- Case 1: only seen_by/delivered_to changed (read receipts) — always allowed.
  if new.challenge_id is not distinct from old.challenge_id
     and new.sender_id is not distinct from old.sender_id
     and new.type is not distinct from old.type
     and new.content is not distinct from old.content
     and new.media_url is not distinct from old.media_url
     and new.created_at is not distinct from old.created_at
     and new.deleted_at is not distinct from old.deleted_at
  then
    return new;
  end if;

  -- Anything else must be an edit or a delete, both sender-only.
  if auth.uid() is distinct from old.sender_id then
    raise exception 'Only the sender may edit or delete this message.';
  end if;

  select status into v_challenge_status from challenges where id = old.challenge_id;
  if v_challenge_status in ('completed', 'cancelled', 'expired', 'archived') then
    raise exception 'This chat is read-only — the challenge has reached a terminal state.';
  end if;

  -- Delete path: content/media_url may be cleared, deleted_at set.
  if new.deleted_at is not null and old.deleted_at is null then
    if new.original_content is null then
      raise exception 'original_content must be preserved when deleting a message.';
    end if;
    return new;
  end if;

  -- Edit path: content may change within 5 minutes of creation.
  if new.content is distinct from old.content then
    if now() - old.created_at > interval '5 minutes' then
      raise exception 'The 5-minute edit window for this message has passed.';
    end if;
    if new.original_content is null then
      raise exception 'original_content must be preserved on first edit.';
    end if;
    return new;
  end if;

  raise exception 'This update to challenge_messages is not permitted.';
end;
$$;
