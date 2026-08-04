-- ============================================================================
-- Migration 0001: Extensions
-- Purpose: enable required PostgreSQL extensions before any table is created.
-- ============================================================================

-- gen_random_uuid() for UUID primary keys
create extension if not exists pgcrypto;

-- gin/gist trigram search, used later for challenge/game search indexes
create extension if not exists pg_trgm;
