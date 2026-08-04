-- ============================================================================
-- Migration 0046: Tournament Lifecycle Engine — New States
--
-- DB-001's tournament_status (draft/registration/check_in/in_progress/
-- completed/archived/cancelled) was a minimal placeholder pending this
-- phase. TOURNAMENT-001 asks for a much more granular state list; six new
-- values are added below.
--
-- NOT added as separate tournament-level states: "Semi Finals" and
-- "Final" — these are round NAMES (tournament_rounds.name, DB-001), not
-- distinct tournament statuses. A semifinal round and a final round both
-- pass through the same round_active -> round_complete cycle; duplicating
-- that as tournament-level enum values would fragment the schema for a
-- purely cosmetic distinction, the same interpretive call CHALLENGE-001
-- made for "Ready Check" vs "Ready".
-- ============================================================================

alter type tournament_status add value if not exists 'published' after 'draft';
alter type tournament_status add value if not exists 'registration_closed' after 'registration';
alter type tournament_status add value if not exists 'bracket_generated' after 'check_in';
alter type tournament_status add value if not exists 'round_active' after 'bracket_generated';
alter type tournament_status add value if not exists 'round_complete' after 'round_active';
alter type tournament_status add value if not exists 'prize_distribution' after 'round_complete';
