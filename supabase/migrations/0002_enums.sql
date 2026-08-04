-- ============================================================================
-- Migration 0002: Enumerated Types
-- Purpose: define every closed-set status/type value used across the schema.
-- Enums are used only where the value set is genuinely closed and unlikely to
-- grow without a corresponding business-rule change (e.g. escrow_status).
-- Open-ended, extensible taxonomies (e.g. audit_logs.action, which enumerates
-- dozens of System Events per Business Rules §18 and will keep growing) are
-- deliberately left as `text` rather than enums, since altering a Postgres
-- enum type is a schema migration in itself and would create needless
-- migration churn every time a new event name is added.
-- ============================================================================

create type user_role as enum ('player', 'moderator', 'administrator');

create type user_status as enum ('unverified', 'active', 'suspended', 'closed');

create type kyc_status as enum ('unverified', 'pending', 'verified', 'rejected');

create type wallet_status as enum ('active', 'frozen');

create type transaction_type as enum (
  'deposit', 'withdrawal', 'stake', 'payout', 'refund', 'fee', 'adjustment'
);

create type transaction_status as enum ('pending', 'completed', 'failed', 'reversed');

-- Business Rules §7: the four documented release reasons for escrow funds.
create type escrow_release_reason as enum (
  'mutual_release', 'moderator_decision', 'auto_expiry', 'refund_void'
);

create type escrow_status as enum ('locked', 'released', 'refunded', 'voided');

-- Ledger account classification. `available`/`escrowed` always carry a
-- wallet_id; the two platform_* values are singleton system accounts and
-- always carry a null wallet_id (enforced by a check constraint on
-- wallet_ledger in migration 0004).
create type ledger_account_type as enum (
  'available', 'escrowed', 'platform_fee_revenue', 'platform_clearing'
);

create type ledger_direction as enum ('debit', 'credit');

-- Full expanded challenge state machine per Business Rules §3 (authoritative,
-- supersedes the shorter version sketched in the Architecture Document).
create type challenge_status as enum (
  'draft', 'published', 'waiting', 'accepted', 'escrow_locked', 'ready',
  'live', 'winner_submitted', 'awaiting_confirmation', 'released',
  'disputed', 'moderator_review', 'completed', 'cancelled', 'expired', 'archived'
);

create type challenge_visibility as enum ('public', 'private', 'friends');

create type challenge_participant_role as enum ('creator', 'opponent');

create type chat_message_type as enum ('text', 'image', 'video', 'voice', 'system');

create type evidence_type as enum ('image', 'video', 'text', 'voice');

create type tournament_status as enum (
  'draft', 'registration', 'check_in', 'in_progress', 'completed', 'archived', 'cancelled'
);

create type tournament_format as enum ('single_elim', 'double_elim', 'round_robin');

create type tournament_round_status as enum ('pending', 'in_progress', 'completed');

create type notification_status as enum ('unread', 'read');

create type friend_request_status as enum ('pending', 'accepted', 'declined', 'blocked');

create type report_status as enum ('open', 'reviewed', 'dismissed');

create type dispute_status as enum ('open', 'under_review', 'resolved');

create type dispute_resolution as enum (
  'winner_confirmed', 'opponent_confirmed', 'split', 'voided'
);

-- Coarse category used for filtering/reporting on audit_logs; the granular
-- `action` column stores the specific System Event name as text (see note above).
create type audit_action_category as enum (
  'auth', 'financial', 'challenge', 'tournament', 'dispute', 'moderation', 'admin', 'system'
);

create type actor_type as enum ('user', 'moderator', 'administrator', 'system');
