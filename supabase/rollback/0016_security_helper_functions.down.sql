-- Rollback 0016: Security Helper Functions
drop function if exists log_security_event(text, text, text, jsonb);
drop function if exists can_release_escrow(uuid);
drop function if exists can_submit_proof(uuid);
drop function if exists is_assigned_moderator(uuid);
drop function if exists is_dispute_participant(uuid);
drop function if exists is_challenge_participant(uuid);
drop function if exists owns_challenge(uuid);
drop function if exists owns_wallet(uuid);
drop function if exists is_active_player();
drop function if exists is_verified();
drop function if exists is_support();
drop function if exists is_moderator();
drop function if exists is_admin();
drop function if exists current_user_id();
