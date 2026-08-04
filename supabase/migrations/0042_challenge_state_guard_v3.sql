-- ============================================================================
-- Migration 0042: Challenge State Guard v3 — escrow_pending + countdown edges
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
    ('escrow_pending', 'cancelled'), -- lock failure path: refund creator, revert
    ('accepted', 'cancelled'),
    ('escrow_locked', 'ready'),
    ('ready', 'countdown'),
    ('countdown', 'live'),
    ('countdown', 'cancelled'), -- a participant drops during countdown
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
