-- ============================================================================
-- Migration 0053: Realtime Publication
--
-- HONESTY NOTE: this migration IS most of the "Realtime Gateway"/
-- "Connection Manager"/"Subscription Manager" this phase asks for — Supabase
-- Realtime's postgres_changes feature streams row-level INSERT/UPDATE/DELETE
-- events to any authorized subscribed client directly from Postgres's
-- replication stream once a table is added to the `supabase_realtime`
-- publication. There is no custom WebSocket/connection-pooling code to
-- write here; reimplementing that would duplicate infrastructure Supabase
-- already runs. What this project's own code contributes is documented in
-- REALTIME_PLATFORM.md: the notification-creation/fan-out logic, chat
-- service, presence service, and read-receipt/typing plumbing — all of
-- which sit ON TOP of this replication layer, not instead of it.
--
-- RLS (already enabled on every table below) is what actually authorizes
-- which connected client receives which row's changes — Realtime
-- subscriptions are RLS-filtered automatically, so adding a table here
-- does not bypass any access control established in DB-002/AUTH-001/
-- CHALLENGE-001/WALLET-001.
-- ============================================================================

alter publication supabase_realtime add table challenges;
alter publication supabase_realtime add table challenge_messages;
alter publication supabase_realtime add table message_receipts;
alter publication supabase_realtime add table wallets;
alter publication supabase_realtime add table escrow_accounts;
alter publication supabase_realtime add table notifications;
alter publication supabase_realtime add table user_presence;
alter publication supabase_realtime add table tournament_rounds;
alter publication supabase_realtime add table tournament_matches;
alter publication supabase_realtime add table disputes;
