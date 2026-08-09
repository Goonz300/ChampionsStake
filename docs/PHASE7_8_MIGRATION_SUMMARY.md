# Phase 7 + 8 Migration Summary

20 migrations, `0086` through `0105`, every one additive (no historical migration edited) with a paired `.down.sql` rollback in `supabase/rollback/`. Enum-value additions (`alter type … add value if not exists`) are documented as irreversible in their rollback files, since Postgres cannot drop an enum value — a known, accepted limitation of the rollback story for those specific migrations, not an oversight.

| Migration | Purpose |
|---|---|
| `0086_trust_engine_v2_foundation` | Trust Engine v2 schema: generic idempotency key for non-challenge-keyed adjustments (withdrawal settled/reversed, tournament no-show, chargeback, sanctions block) |
| `0087_risk_engine_and_fraud_intelligence` | `risk_scores` table, IP-intelligence supporting tables |
| `0088_ip_intelligence_scheduler` | `pg_cron` job: TOR/datacenter IP refresh, every 6h |
| `0089_reputation_engine` | `reputation_scores`/`reputation_history` |
| `0090_reputation_engine_scheduler` | `pg_cron` job: reputation sweep, every 30 min |
| `0091_ai_moderation_assistant` | `moderation_case_suggestions` — assistive-only, documented as never writing `disputes.priority` |
| `0092_moderation_assistant_scheduler` | `pg_cron` job: moderation suggestion sweep, every 15 min |
| `0093_tournament_format_swiss` | Widens `tournament_format` enum to include `'swiss'` |
| `0094_team_platform` | `teams`, `team_members`, `team_invitations` |
| `0095_league_and_season_platform` | `leagues`, `divisions`, `seasons`, `season_participants` |
| `0096_season_lifecycle` | Season lifecycle support columns |
| `0097_season_rollover_scheduler` | `pg_cron` job: season rollover, hourly |
| `0098_ranking_platform` | `player_ratings`, `rating_history` (Glicko-1, scope-typed) |
| `0099_ranking_engine_scheduler` | `pg_cron` job: rating sweep, every 10 min |
| `0100_organizer_platform` | `tournaments.visibility/is_recurring/recurrence_rule/template_id/sponsor_*`, `tournament_templates`, `tournament_invitations` |
| `0101_spectator_platform_publication` | Adds `tournaments, tournament_registrations, season_participants, player_ratings, team_members` to the `supabase_realtime` publication |
| `0102_tournament_scheduling_sweep` | Scheduling-sweep supporting columns/indexes |
| `0103_moderation_queue_risk_signal` | *(Cross-system integration fix)* `v_moderator_queue` view extended to join `moderation_case_suggestions`, using the AI risk signal as a same-tier tie-break only — `disputes.priority` (human-set) remains the sole primary sort key |
| `0104_phase8_performance_indexes` | *(Performance review fix)* `idx_seasons_status_ends_at`, `idx_season_participants_user_id`/`_team_id`, `idx_tournaments_created_by_game_id` |
| `0105_hostile_review_fixes` | *(Hostile review fix)* `uq_seasons_one_active_per_league` partial unique index, closing the `startSeason` TOCTOU race |

## Rules followed

- **Additive only**: every migration is a new file; nothing in `0001`-`0085` was edited.
- **Paired rollback**: every migration has a `supabase/rollback/<name>.down.sql`.
- **View changes are new migrations, not edits**: `0103`'s `create or replace view` is itself a forward migration (a new file), not a modification of `0059`'s original view-defining migration.
- **RLS "additive widening"**: no existing RLS policy was replaced or narrowed; new `for select using (true)`-style policies coexist with existing narrower ones (Postgres RLS policies are OR'd together), used specifically to fix `tournament_registrations`' overly-narrow pre-existing RLS without touching the original policy.

## Cron jobs introduced (all `pg_cron` + `pg_net.http_post` + Vault-stored secret, mirroring the pre-existing migration-0061 pattern exactly)

| Job | Cadence |
|---|---|
| `ai-ip-intelligence` | every 6 hours |
| `ai-reputation-engine` | every 30 minutes |
| `ai-moderation-assistant` | every 15 minutes |
| `ranking-engine` | every 10 minutes |
| `season-rollover` | hourly |
| `tournament-scheduling-sweep` | every 5 minutes |
