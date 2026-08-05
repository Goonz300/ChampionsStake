-- ============================================================================
-- Migration 0067: Identity Lookup Tables (Countries, Languages, Timezones)
--
-- SCOPE NOTE (Phase 2 gap audit): profiles.country_code (0003) has always
-- been free text with no validating table behind it, and no language or
-- timezone concept has ever existed on profiles. This migration adds three
-- normalized lookup tables, mirroring the existing platforms/regions
-- pattern (0006) exactly (code text primary key, name, active, timestamps).
--
-- BACKWARDS COMPATIBILITY: profiles.country_code is NOT removed, renamed,
-- or retyped. A foreign key is added to it using `NOT VALID`, Postgres's
-- native mechanism for "enforce on every new/updated row from here on,
-- without retroactively validating (and potentially breaking on) existing
-- rows" -- this is the correct, idiomatic reading of this phase's "create
-- foreign keys for future records" requirement; a plain FOREIGN KEY has no
-- such distinction in Postgres. language_code/timezone_name are new,
-- nullable columns (no prior column to preserve), so their FKs need no
-- such carve-out.
-- ============================================================================

create table countries (
  code text primary key, -- ISO 3166-1 alpha-2
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table countries is
  'Seedable lookup of ISO 3166-1 alpha-2 country codes, mirroring the platforms/regions pattern (0006). `active` is a data-availability flag only -- it is NOT a jurisdictional/legal eligibility decision (e.g. for KYC or real-money wagering availability), which is a compliance decision outside this schema''s scope and must not be inferred from this column.';

create table languages (
  code text primary key, -- ISO 639-1
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table languages is 'Seedable lookup of ISO 639-1 language codes.';

create table timezones (
  name text primary key, -- IANA tz database name, e.g. 'America/New_York'
  utc_offset_minutes int,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table timezones is
  'Seedable lookup of IANA timezone names. Seeded in the next migration directly from Postgres''s own pg_timezone_names, the authoritative source, rather than a hand-maintained list.';

-- All three are reference data: readable by anyone (including anonymous,
-- for signup-flow dropdowns), writable only by admins.
alter table countries enable row level security;
alter table countries force row level security;
create policy countries_select_all on countries for select using (true);
create policy countries_write_admin on countries for all using (is_admin()) with check (is_admin());

alter table languages enable row level security;
alter table languages force row level security;
create policy languages_select_all on languages for select using (true);
create policy languages_write_admin on languages for all using (is_admin()) with check (is_admin());

alter table timezones enable row level security;
alter table timezones force row level security;
create policy timezones_select_all on timezones for select using (true);
create policy timezones_write_admin on timezones for all using (is_admin()) with check (is_admin());

-- profiles extensions -----------------------------------------------------
-- Normalize existing casing (ISO codes are uppercase) so the widest
-- possible set of existing rows satisfies the new FK once added. This is
-- the "migration for existing data" -- it does not invent or repair
-- genuinely invalid codes, which the NOT VALID constraint below
-- deliberately leaves ungrandfathered rather than silently discarding.
update profiles set country_code = upper(country_code)
  where country_code is not null and country_code <> upper(country_code);

alter table profiles
  add constraint fk_profiles_country_code
  foreign key (country_code) references countries (code)
  not valid;
comment on constraint fk_profiles_country_code on profiles is
  'NOT VALID by design: enforced on all new/updated rows immediately; pre-existing rows are not retroactively validated. Run VALIDATE CONSTRAINT fk_profiles_country_code once existing data is confirmed clean.';

alter table profiles add column language_code text references languages (code);
alter table profiles add column timezone_name text references timezones (name);
comment on column profiles.language_code is 'Optional preferred language (ISO 639-1). Null = no preference set; application layer falls back to a default.';
comment on column profiles.timezone_name is 'Optional preferred IANA timezone. Null = no preference set; application layer falls back to UTC or client-detected timezone.';
