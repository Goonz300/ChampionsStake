-- ============================================================================
-- Migration 0047: Tournament State Guard v2
-- ============================================================================

create or replace function fn_tournament_state_guard()
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
    ('published', 'registration'),
    ('published', 'cancelled'),
    ('registration', 'registration_closed'),
    ('registration', 'cancelled'),
    ('registration_closed', 'check_in'),
    ('registration_closed', 'cancelled'),
    ('check_in', 'bracket_generated'),
    ('check_in', 'cancelled'),
    ('bracket_generated', 'round_active'),
    ('round_active', 'round_complete'),
    ('round_complete', 'round_active'), -- next round begins
    ('round_complete', 'prize_distribution'), -- final round just completed
    ('prize_distribution', 'completed'),
    ('completed', 'archived'),
    ('cancelled', 'archived')
  );

  if not v_allowed then
    raise exception
      'Invalid tournament status transition % -> % for tournament id=%.',
      old.status, new.status, old.id;
  end if;

  return new;
end;
$$;
