-- Rollback 0074: Session MFA-Verified Column
alter table user_sessions drop column if exists mfa_verified_at;
