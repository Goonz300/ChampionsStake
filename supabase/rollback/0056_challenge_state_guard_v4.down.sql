-- Rollback 0056: Challenge State Guard v4
-- Restores the v3 (migration 0042) version, without escrow_locked->cancelled.
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
