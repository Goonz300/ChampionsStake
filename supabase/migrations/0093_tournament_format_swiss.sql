-- ============================================================================
-- Migration 0093: Tournament Format -- Swiss (Phase 8 TOURNAMENT-002)
--
-- tournament_format (migration 0002) has single_elim/double_elim/round_robin.
-- This phase implements real bracket generation for all three plus Swiss
-- (bracket.ts's swissGenerator + computeNextSwissRound) -- Swiss needs its
-- own enum value to actually be selectable.
--
-- League/Season are NOT added here: they are a separate persistent
-- structure that CONTAINS multiple tournaments over time (Phase 8 M3), not
-- a value of a single tournament's own format. Hybrid/Custom/Group Stage
-- are not added either -- genuinely ambiguous without more specification
-- (same "don't invent business rules unilaterally" discipline bracket.ts's
-- own header already applies to Swiss/round-robin tiebreaks), documented
-- as a gap in docs/TOURNAMENT_ENGINE_DESIGN.md rather than guessed at.
-- ============================================================================

alter type tournament_format add value if not exists 'swiss';
