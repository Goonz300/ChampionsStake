-- ============================================================================
-- Migration 0052: Notification Categories
--
-- DB-001's notifications.type is a free-text System Event name (deliberate,
-- per that migration's comment, to avoid enum churn as events grow). This
-- phase asks for 10 named CATEGORIES (Challenge/Tournament/Wallet/Escrow/
-- Moderator/System/Security/Friends/Platform/Announcements) for grouping
-- and per-category preference filtering — a coarser, genuinely closed
-- classification layered on top of the existing open-ended `type`, the
-- same category/action split audit_logs already uses (DB-002).
-- ============================================================================

create type notification_category as enum (
  'challenge', 'tournament', 'wallet', 'escrow', 'moderator',
  'system', 'security', 'friends', 'platform', 'announcements'
);

alter table notifications add column category notification_category not null default 'system';

create index idx_notifications_user_category on notifications (user_id, category, created_at desc);
