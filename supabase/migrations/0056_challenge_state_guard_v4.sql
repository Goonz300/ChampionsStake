-- ============================================================================
-- Migration 0056: Challenge State Guard v4 — escrow_locked -> cancelled
--
-- BUG FOUND WHILE DESIGNING ADMIN-001's "Force Cancel": migration 0042 gave
-- every pre-live state a path to 'cancelled' EXCEPT escrow_locked (which
-- only had one outgoing edge: ->ready). An admin needing to force-cancel a
-- challenge stuck in escrow_locked (e.g. neither participant ever
-- ready-checks) would hit the guard trigger with no legal transition.
-- Scope boundary, stated explicitly: force-cancel is intentionally only
-- extended up through escrow_locked/ready/countdown (pre-live) — once
-- 'live' or a winner is submitted, real gameplay/claims are in progress,
-- and Business Rules-appropriate handling is the existing
-- live/winner_submitted/awaiting_confirmation -> moderator_review path
-- (ESCROW-001), not a raw admin override skipping that judgment.
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
    ('accepted', 'escrow_pending'),
    ('escrow_pending', 'escrow_locked'),
    ('escrow_pending', 'cancelled'),
    ('accepted', 'cancelled'),
    ('escrow_locked', 'ready'),
    ('escrow_locked', 'cancelled'), -- ADMIN-001 force-cancel gap fix
    ('ready', 'countdown'),
    ('countdown', 'live'),
    ('countdown', 'cancelled'),
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
