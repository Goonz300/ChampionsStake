-- Rollback 0047: Tournament State Guard v2
-- Restores DB-001's original (minimal) version.
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
    ('draft', 'registration'),
    ('registration', 'check_in'),
    ('registration', 'cancelled'),
    ('check_in', 'in_progress'),
    ('check_in', 'cancelled'),
    ('in_progress', 'completed'),
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
