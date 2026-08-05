-- Rollback 0067: Identity Lookup Tables
alter table profiles drop column if exists timezone_name;
alter table profiles drop column if exists language_code;
alter table profiles drop constraint if exists fk_profiles_country_code;
-- profiles.country_code itself (0003) is untouched by this rollback -- it
-- predates this migration and this migration never altered its type or data
-- (only normalized casing, which is not reversible or harmful to leave).
drop table if exists timezones;
drop table if exists languages;
drop table if exists countries;
