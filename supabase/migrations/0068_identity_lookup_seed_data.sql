-- ============================================================================
-- Migration 0068: Identity Lookup Seed Data
--
-- Countries/languages: seeded with a curated, production-safe subset (major
-- markets + broad regional coverage), matching the same curation style as
-- 0014's games/platforms/regions rather than a hand-typed full ISO list
-- (249 countries / 184 languages) that would be both error-prone to author
-- by hand and unnecessary to ship in one migration. Idempotent (on conflict
-- do nothing), safe to re-run, same convention as 0014.
--
-- IMPORTING THE FULL ISO REFERENCE SETS: countries/languages both use a
-- plain (code text primary key, name text, active boolean) shape with no
-- other required columns, so the complete ISO 3166-1 alpha-2 / ISO 639-1
-- lists can be loaded later, additively, with no schema change and no
-- conflict with the rows below:
--   copy countries (code, name) from '<path-to-iso-3166-1-csv>' csv header;
--   copy languages (code, name) from '<path-to-iso-639-1-csv>' csv header;
-- Both use `on conflict (code) do nothing` semantics if inserted via SQL
-- instead of COPY, so re-running against the rows seeded here is safe.
--
-- Timezones: seeded directly from Postgres's own pg_timezone_names, the
-- authoritative source for this Postgres version's tzdata -- not hand-typed,
-- so it is complete (all ~1000 IANA zones this server recognizes) and
-- correct by construction.
-- ============================================================================

insert into countries (code, name) values
  ('US', 'United States'), ('CA', 'Canada'), ('MX', 'Mexico'),
  ('GB', 'United Kingdom'), ('IE', 'Ireland'), ('FR', 'France'), ('DE', 'Germany'),
  ('ES', 'Spain'), ('PT', 'Portugal'), ('IT', 'Italy'), ('NL', 'Netherlands'),
  ('BE', 'Belgium'), ('CH', 'Switzerland'), ('AT', 'Austria'), ('SE', 'Sweden'),
  ('NO', 'Norway'), ('DK', 'Denmark'), ('FI', 'Finland'), ('PL', 'Poland'),
  ('CZ', 'Czechia'), ('GR', 'Greece'), ('RO', 'Romania'),
  ('BR', 'Brazil'), ('AR', 'Argentina'), ('CL', 'Chile'), ('CO', 'Colombia'),
  ('PE', 'Peru'),
  ('JP', 'Japan'), ('KR', 'South Korea'), ('CN', 'China'), ('IN', 'India'),
  ('SG', 'Singapore'), ('MY', 'Malaysia'), ('PH', 'Philippines'), ('ID', 'Indonesia'),
  ('TH', 'Thailand'), ('VN', 'Vietnam'), ('TW', 'Taiwan'), ('HK', 'Hong Kong'),
  ('AU', 'Australia'), ('NZ', 'New Zealand'),
  ('AE', 'United Arab Emirates'), ('SA', 'Saudi Arabia'), ('IL', 'Israel'),
  ('TR', 'Turkey'), ('ZA', 'South Africa'), ('NG', 'Nigeria'), ('EG', 'Egypt'),
  ('KE', 'Kenya')
on conflict (code) do nothing;

insert into languages (code, name) values
  ('en', 'English'), ('es', 'Spanish'), ('fr', 'French'), ('de', 'German'),
  ('pt', 'Portuguese'), ('it', 'Italian'), ('nl', 'Dutch'), ('sv', 'Swedish'),
  ('no', 'Norwegian'), ('da', 'Danish'), ('fi', 'Finnish'), ('pl', 'Polish'),
  ('cs', 'Czech'), ('el', 'Greek'), ('ro', 'Romanian'), ('tr', 'Turkish'),
  ('ru', 'Russian'), ('ja', 'Japanese'), ('ko', 'Korean'), ('zh', 'Chinese'),
  ('hi', 'Hindi'), ('ar', 'Arabic'), ('th', 'Thai'), ('vi', 'Vietnamese'),
  ('id', 'Indonesian'), ('ms', 'Malay')
on conflict (code) do nothing;

insert into timezones (name, utc_offset_minutes)
select tz.name, (extract(epoch from tz.utc_offset) / 60)::int
from pg_timezone_names tz
on conflict (name) do nothing;
