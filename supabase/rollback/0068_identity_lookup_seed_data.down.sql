-- Rollback 0068: Identity Lookup Seed Data
-- Reference/lookup data only (no user-generated rows expected -- RLS
-- restricts writes to admins), so a full delete is safe rather than
-- reversing the exact seeded rows individually.
delete from timezones;
delete from languages;
delete from countries;
