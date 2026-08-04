-- Rollback 0006: Games, Platforms, Regions, Challenges
alter table escrow_accounts drop constraint if exists fk_escrow_accounts_challenge;
alter table wallet_transactions drop constraint if exists fk_wallet_transactions_challenge;
drop table if exists challenge_attachments;
drop table if exists challenge_messages;
drop table if exists challenge_events;
drop table if exists challenge_participants;
drop table if exists challenges;
drop table if exists games;
drop table if exists regions;
drop table if exists platforms;
