-- Rollback 0078: Realtime Broadcast Authorization (Typing Channel Isolation)
drop policy if exists realtime_chat_broadcast_participants_select on realtime.messages;
drop policy if exists realtime_chat_broadcast_participants_insert on realtime.messages;
alter table realtime.messages disable row level security;
