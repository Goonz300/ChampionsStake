-- ============================================================================
-- Migration 0040: Challenge State Guard — Missing Edges Fix
--
-- BUG FOUND DURING ESCROW-001: DB-001's fn_challenge_state_guard (migration
-- 0011) omitted two valid transitions that the actual escrow engine needs:
--
-- 1. ('published', 'accepted') — the original graph only allowed
--    'waiting' -> 'accepted'. But Business Rules §3 describes 'waiting' as
--    merely "an alias for published while unaccepted," not a state the
--    engine actually transitions into separately — challenges go straight
--    from 'published' to 'accepted' in every real flow. Without this edge,
--    accepting any published challenge would be rejected by the trigger.
--
-- 2. ('draft', 'cancelled') — a user must be able to discard a draft
--    challenge before publishing it. Challenges are never deleted (Business
--    Rules §7/§15 — "never deleted", only cancelled/expired/archived), so a
--    draft needs a legal path to 'cancelled' just like every other state.
--
-- This is exactly the kind of "verified implementation issue" every prior
-- phase's scope allowed fixing — a state-machine trigger that would
-- otherwise block core, expected escrow engine functionality.
-- ============================================================================

create or replace function fn_challenge_state_guard()
returns trigger
language plpgsql
as $$
declare
  v_allowed boolean;
begin
  if new.status = old.status then
    return new;
  end if;

  v_allowed := (old.status, new.status) in (
    ('draft', 'published'),
    ('draft', 'cancelled'),
    ('published', 'waiting'),
    ('published', 'accepted'),
    ('published', 'expired'),
    ('published', 'cancelled'),
    ('waiting', 'accepted'),
    ('waiting', 'expired'),
    ('waiting', 'cancelled'),
    ('accepted', 'escrow_locked'),
    ('accepted', 'cancelled'),
    ('escrow_locked', 'ready'),
    ('ready', 'live'),
    ('ready', 'cancelled'),
    ('live', 'winner_submitted'),
    ('live', 'moderator_review'),
    ('winner_submitted', 'awaiting_confirmation'),
    ('winner_submitted', 'disputed'),
    ('awaiting_confirmation', 'released'),
    ('awaiting_confirmation', 'disputed'),
    ('awaiting_confirmation', 'moderator_review'),
    ('disputed', 'moderator_review'),
    ('moderator_review', 'completed'),
    ('moderator_review', 'cancelled'),
    ('released', 'completed'),
    ('completed', 'archived'),
    ('cancelled', 'archived'),
    ('expired', 'archived')
  );

  if not v_allowed then
    raise exception
      'Invalid challenge status transition % -> % for challenge id=%.',
      old.status, new.status, old.id;
  end if;

  return new;
end;
$$;
