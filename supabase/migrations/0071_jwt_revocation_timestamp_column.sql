-- ============================================================================
-- Migration 0071: JWT Revocation Timestamp
--
-- Phase 3A (Authentication implementation), per the approved Phase 3
-- Architecture Rev. 2, §4/§12. Closes the stateless-access-token revocation
-- window: a per-user "sessions issued before this instant are no longer
-- valid" marker, compared against a JWT's own `iat` claim in
-- _shared/auth/jwt.ts / _shared/auth/session.ts. Written by
-- /api/auth/logout-all (the only Phase 3A caller — admin-forced-logout,
-- which would also write it, is explicitly out of scope for this phase and
-- does not exist yet).
--
-- Chosen over a per-token deny-list because loadUserProfile (0003) already
-- fetches this user's profiles row on every authenticated request; adding
-- one column to that existing query is near-zero marginal cost, unlike a
-- deny-list, which would be a genuinely new lookup on every request across
-- all 66 Edge Functions.
-- ============================================================================

alter table profiles add column sessions_invalidated_at timestamptz;
comment on column profiles.sessions_invalidated_at is
  'Set to now() whenever every session for this user should be treated as revoked, regardless of natural JWT expiry (currently written only by /api/auth/logout-all). Compared against a JWT''s own iat claim in _shared/auth/session.ts''s assertSessionNotInvalidated -- a token issued before this timestamp is rejected even though it has not yet naturally expired. Null = never invalidated (the default state for every existing and new row).';
