-- ============================================================================
-- Migration 0041: Challenge Lifecycle Engine — New States
--
-- CHALLENGE-001 asks for 'Escrow Pending' and 'Countdown' as explicit
-- states beyond what DB-001/ESCROW-001 modeled. Both are genuine additions:
--   escrow_pending — the async window between "accept" being called and the
--     wallet lock actually confirming, previously collapsed into a single
--     synchronous step in ESCROW-001. Splitting it out means a failed lock
--     leaves the challenge in a recoverable, visible state instead of
--     silently retrying inside one request.
--   countdown — the brief window between both players confirming ready and
--     the match actually starting, previously collapsed directly into
--     'live'. Needed so a scheduler (challenge-start) has something to
--     transition FROM once the countdown timer elapses server-side.
--
-- NOT added as a new state: 'Ready Check' from the brief's state list.
-- Reviewing Business Rules §3/§4, "Ready Check" describes the *process* of
-- checking readiness, and the existing 'ready' enum value already
-- represents exactly that window (players confirming presence before
-- countdown). Adding a second, functionally-identical state would fragment
-- the already-approved schema without a behavioral difference — documented
-- here rather than silently doing it anyway.
-- ============================================================================

alter type challenge_status add value if not exists 'escrow_pending' after 'accepted';
alter type challenge_status add value if not exists 'countdown' after 'ready';
