-- 0105_hostile_review_fixes.sql
--
-- Hostile security review finding (Low): _league/season-service.ts's
-- startSeason checked "does this league already have an active season"
-- with a plain SELECT, then did an unguarded INSERT -- a TOCTOU window
-- where two concurrent start_season calls for the same league could both
-- pass the check and both insert an active season row. Enforced at the DB
-- level instead of relying on an application-level check-then-act: a
-- partial unique index makes the second concurrent insert fail with a
-- 23505, which the application already knows how to catch and translate
-- (same insert-then-catch-on-23505 pattern used throughout this codebase,
-- e.g. _wallet/escrow-accounts.ts, _team/service.ts's slug retry).
create unique index uq_seasons_one_active_per_league on seasons (league_id)
  where status = 'active';
