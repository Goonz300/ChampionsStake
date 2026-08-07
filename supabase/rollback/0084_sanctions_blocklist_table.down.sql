-- Rollback 0084: Sanctions/PEP Screening Blocklist
drop policy if exists sanctions_blocklist_select_staff on sanctions_blocklist;
drop table if exists sanctions_blocklist;
