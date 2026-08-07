-- ============================================================================
-- Migration 0096: Season Lifecycle (Phase 8 TOURNAMENT-005)
--
-- reward_structure: optional admin-configured rank -> amount_cents mapping
-- (e.g. {"1": 500000, "2": 300000}), defaulting to empty (no monetary
-- reward -- a purely competitive league is a valid, common configuration).
-- Leagues have no entry-fee/stake concept (unlike tournaments/challenges),
-- so a season reward is necessarily PLATFORM-funded, not paid from a
-- player-funded pool -- reusing platformToWallet (_wallet/transfer.ts),
-- the existing single-actor "platform-funded credit" primitive (already
-- used for promotional bonuses), rather than the four-eyes
-- administrativeAdjustment flow. That distinction is deliberate:
-- administrativeAdjustment's two-admin-approval requirement exists for
-- CORRECTIVE adjustments to an existing balance (the same class of action
-- as "conjuring money outside the normal flow", which needs a second set
-- of eyes) -- platformToWallet already has established precedent as the
-- lighter-weight primitive for a platform benefit that's a normal,
-- expected part of a feature's operation, same category as this one.
--
-- season_reward is a new transaction_type value (additive, matching the
-- existing enum-extension pattern already used repeatedly in this schema
-- for chargeback/bonus_credit/tournament_prize etc., migration 0002/0035).
-- ============================================================================

alter table seasons add column reward_structure jsonb not null default '{}'::jsonb;
comment on column seasons.reward_structure is
  'Optional rank (as a string key, e.g. "1") -> amount_cents mapping, applied at season end. Empty object = no monetary reward.';

alter type transaction_type add value if not exists 'season_reward';
