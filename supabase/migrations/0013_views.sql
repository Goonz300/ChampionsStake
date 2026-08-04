-- ============================================================================
-- Migration 0013: Views
-- Read-only convenience views. RLS on underlying tables (Phase 2) applies
-- automatically to views in Postgres/Supabase (security_invoker semantics
-- are set explicitly below to guarantee this, rather than relying on defaults).
-- ============================================================================

create view v_active_challenges
with (security_invoker = true) as
select
  c.id,
  c.creator_id,
  c.opponent_id,
  c.game_id,
  g.name as game_name,
  c.stake_cents,
  c.visibility,
  c.status,
  c.platform_code,
  c.region_code,
  c.created_at,
  c.expires_at
from challenges c
join games g on g.id = c.game_id
where c.status in (
  'published', 'waiting', 'accepted', 'escrow_locked', 'ready', 'live',
  'winner_submitted', 'awaiting_confirmation', 'disputed', 'moderator_review'
);
comment on view v_active_challenges is 'Challenges in any non-terminal state, for dashboard/browse queries.';

create view v_live_matches
with (security_invoker = true) as
select
  c.id,
  c.creator_id,
  c.opponent_id,
  c.game_id,
  c.stake_cents,
  c.live_started_at,
  c.tournament_id
from challenges c
where c.status = 'live';
comment on view v_live_matches is 'Currently live 1v1 or tournament matches.';

create view v_leaderboard
with (security_invoker = true) as
select
  p.id as user_id,
  p.display_name,
  p.avatar_url,
  p.trust_score,
  p.completion_rate,
  rank() over (order by p.trust_score desc) as rank
from profiles p
where p.status = 'active';
comment on view v_leaderboard is 'Global leaderboard ranked by trust score (Business Rules §13). Filter by game in application layer via challenge history if a per-game leaderboard is needed.';

create view v_wallet_summary
with (security_invoker = true) as
select
  w.id as wallet_id,
  w.user_id,
  w.available_cents,
  w.escrowed_cents,
  w.available_cents + w.escrowed_cents as total_cents,
  fn_wallet_balance(w.id, 'available') as ledger_derived_available_cents,
  fn_wallet_balance(w.id, 'escrowed') as ledger_derived_escrowed_cents,
  w.status,
  w.updated_at
from wallets w;
comment on view v_wallet_summary is
  'Compares wallets'' cached balance columns against the ledger-derived truth — the two "ledger_derived_*" columns should always equal the cached ones; divergence indicates a reconciliation issue (Readiness Report §9/§13).';

create view v_escrow_summary
with (security_invoker = true) as
select
  e.id as escrow_account_id,
  e.challenge_id,
  e.tournament_id,
  e.status,
  e.total_locked_cents,
  coalesce(sum(et.amount_cents) filter (where et.action = 'lock'), 0)
    - coalesce(sum(et.amount_cents) filter (where et.action in ('release', 'refund', 'void')), 0)
    as computed_locked_cents,
  e.release_reason,
  e.released_at
from escrow_accounts e
left join escrow_transactions et on et.escrow_account_id = e.id
group by e.id;
comment on view v_escrow_summary is
  'Escrow account status alongside a computed balance from escrow_transactions, for reconciliation.';

create view v_tournament_overview
with (security_invoker = true) as
select
  t.id,
  t.name,
  t.game_id,
  g.name as game_name,
  t.format,
  t.status,
  t.entry_fee_cents,
  t.prize_pool_cents,
  count(tr.id) as registered_count,
  count(tr.id) filter (where tr.checked_in_at is not null) as checked_in_count,
  t.starts_at
from tournaments t
join games g on g.id = t.game_id
left join tournament_registrations tr on tr.tournament_id = t.id
group by t.id, g.name;
comment on view v_tournament_overview is 'Tournament summary with live registration/check-in counts.';

create view v_moderator_queue
with (security_invoker = true) as
select
  d.id as dispute_id,
  d.challenge_id,
  d.status,
  d.assigned_moderator_id,
  d.opened_by,
  d.evidence_deadline_at,
  d.created_at,
  extract(epoch from (now() - d.created_at)) / 3600 as hours_open
from disputes d
where d.status in ('open', 'under_review')
order by d.created_at asc;
comment on view v_moderator_queue is
  'Open/under-review disputes ordered oldest-first, for the moderator dispute queue.';
