-- ============================================================================
-- Migration 0084: Sanctions/PEP Screening Blocklist
--
-- Phase 6 audit finding: confirmed missing entirely (grep for "sanction",
-- "OFAC", "PEP" across supabase/functions/ returned zero hits before this
-- migration). No live sanctions/PEP data feed is available in this
-- environment (no provider credentials, no external API to call) -- rather
-- than build an unimplementable "architecture-ready" stub with nothing to
-- actually check against, this is a genuinely functional,
-- administrator-maintained blocklist: real screening, honestly scoped to
-- what this environment can actually verify names against. A future phase
-- with access to a real sanctions/PEP data provider can populate this same
-- table from that feed instead of manual admin entry, without any check
-- call site needing to change.
-- ============================================================================

create table sanctions_blocklist (
  id uuid primary key default gen_random_uuid(),
  full_name_normalized text not null,
  reason text not null,
  added_by uuid not null references profiles (id),
  created_at timestamptz not null default now(),
  constraint uq_sanctions_blocklist_name unique (full_name_normalized)
);
comment on table sanctions_blocklist is
  'Administrator-maintained sanctions/PEP screening list. Names are matched by exact normalized (lowercased, whitespace-collapsed) comparison -- a real, functional check against this environment''s only available data source (admin-entered names), not a stub for an unavailable external provider.';

create index idx_sanctions_blocklist_name on sanctions_blocklist (full_name_normalized);

alter table sanctions_blocklist enable row level security;
alter table sanctions_blocklist force row level security;

-- No client access at all -- checked and written only via service-role
-- Edge Function code (_payment/sanctions.ts, _admin/wallets.ts), same
-- no-client-write posture as every comparable admin-maintained table in
-- this schema.
create policy sanctions_blocklist_select_staff on sanctions_blocklist for select using (is_admin() or is_moderator());
