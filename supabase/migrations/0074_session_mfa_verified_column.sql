-- ============================================================================
-- Migration 0074: Session MFA-Verified Column
--
-- Phase 3C (MFA & Advanced Account Security), independent-review finding.
-- Additive only -- no existing migration, table, enum, function, or RLS
-- policy touched.
--
-- WHY THIS EXISTS: GoTrue's own Authenticator Assurance Level (aal2) is the
-- primary signal that a session completed MFA, and is sufficient on its own
-- for real TOTP-verified logins (verifying a TOTP factor promotes the
-- session to aal2 natively). But a login completed via a recovery code
-- (lib/auth/recovery-codes.ts) deliberately does NOT and cannot elevate
-- GoTrue's aal2 -- GoTrue has no concept of recovery codes at all -- yet
-- that login is still legitimate and must be allowed to reach the app.
-- Without an app-level marker, middleware has no way to distinguish "this
-- session finished login via a recovery code" from "this session never
-- completed MFA at all", which is exactly the ambiguity a strict aal2-only
-- middleware gate cannot resolve (see docs/PHASE-3C-deliverable.md).
-- ============================================================================

alter table user_sessions add column mfa_verified_at timestamptz;
comment on column user_sessions.mfa_verified_at is
  'Set when this session completed login via a recovery code (lib/auth/recovery-codes.ts consumeRecoveryCode, called from /api/auth/mfa/recovery-codes/verify) -- the one login-completion path GoTrue''s own aal2 cannot represent. Never set for TOTP-verified logins, which rely on GoTrue''s native aal2 instead. Null for sessions recorded before this migration and for any session that has not completed MFA via a recovery code. Read by middleware.ts (via lib/supabase/middleware.ts''s updateSession) as a fallback MFA-satisfied signal alongside aal2.';
