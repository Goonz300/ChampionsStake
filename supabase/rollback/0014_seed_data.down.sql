-- Rollback 0014: Seed Data
delete from system_settings where key in (
  'stake_min_cents','stake_max_cents_pre_kyc','deposit_min_cents','deposit_max_cents_per_txn',
  'deposit_max_cents_rolling_24h','withdrawal_min_cents','kyc_pre_verification_stake_cap_cents',
  'challenge_publish_expiry_hours','opponent_stake_capture_timeout_minutes','ready_check_timeout_minutes',
  'winner_submitted_response_hours','dispute_evidence_window_hours','moderator_review_sla_hours',
  'appeal_window_hours','tournament_check_in_window_minutes','pending_deposit_auto_reversal_hours',
  'email_verification_link_expiry_hours','platform_fee_percent'
);
delete from feature_flags where key in (
  'deposits_enabled','withdrawals_enabled','challenge_creation_enabled','tournaments_enabled','ai_recommendations_enabled'
);
delete from games where slug in (
  'valorant','league-of-legends','call-of-duty','ea-sports-fc','fortnite','rocket-league','apex-legends','counter-strike-2'
);
delete from regions where code in ('na','eu','apac','latam','mena','oceania','global');
delete from platforms where code in ('pc','playstation','xbox','nintendo_switch','mobile','cross_platform');
