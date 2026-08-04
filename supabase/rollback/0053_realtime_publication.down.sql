-- Rollback 0053: Realtime Publication
alter publication supabase_realtime drop table disputes;
alter publication supabase_realtime drop table tournament_matches;
alter publication supabase_realtime drop table tournament_rounds;
alter publication supabase_realtime drop table user_presence;
alter publication supabase_realtime drop table notifications;
alter publication supabase_realtime drop table escrow_accounts;
alter publication supabase_realtime drop table wallets;
alter publication supabase_realtime drop table message_receipts;
alter publication supabase_realtime drop table challenge_messages;
alter publication supabase_realtime drop table challenges;
