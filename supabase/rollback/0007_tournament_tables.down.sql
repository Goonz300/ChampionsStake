-- Rollback 0007: Tournament Tables
alter table escrow_accounts drop constraint if exists fk_escrow_accounts_tournament;
alter table wallet_transactions drop constraint if exists fk_wallet_transactions_tournament;
alter table challenges drop constraint if exists fk_challenges_tournament;
drop table if exists tournament_matches;
drop table if exists tournament_rounds;
drop table if exists tournament_registrations;
drop table if exists tournaments;
