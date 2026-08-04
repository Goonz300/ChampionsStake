-- Rollback 0050: Message Receipts Table
drop policy if exists message_receipts_update_own on message_receipts;
drop policy if exists message_receipts_upsert_own on message_receipts;
drop policy if exists message_receipts_select_participant on message_receipts;
drop table if exists message_receipts;
