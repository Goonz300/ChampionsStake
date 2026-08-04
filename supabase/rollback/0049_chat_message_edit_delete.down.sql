-- Rollback 0049: Chat Message Editing & Deletion
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

alter table challenge_messages
  drop column if exists delivered_to,
  drop column if exists original_content,
  drop column if exists deleted_at,
  drop column if exists edited_at;
