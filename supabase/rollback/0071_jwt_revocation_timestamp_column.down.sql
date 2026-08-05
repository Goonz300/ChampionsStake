-- Rollback 0071: JWT Revocation Timestamp
alter table profiles drop column if exists sessions_invalidated_at;
