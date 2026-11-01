-- Contacts (server/contacts): people who answered any form, grouped by email, else by phone.
-- Derived from responses, so there is no separate table to keep in sync. A BEFORE trigger reads
-- the response's form version and copies the first non-empty email, name and phone answers into
-- columns; contact_key ("e:<email>" or "p:<E.164 phone>") is generated from them.

ALTER TABLE responses ADD COLUMN IF NOT EXISTS contact_email text;
ALTER TABLE responses ADD COLUMN IF NOT EXISTS contact_name text;
ALTER TABLE responses ADD COLUMN IF NOT EXISTS contact_phone text;
-- Generated columns are computed after BEFORE triggers, so the trigger's values are seen here.
ALTER TABLE responses ADD COLUMN IF NOT EXISTS contact_key text GENERATED ALWAYS AS (
  CASE
    WHEN contact_email IS NOT NULL THEN 'e:' || contact_email
    WHEN contact_phone IS NOT NULL THEN 'p:' || contact_phone
  END
) STORED;

-- Fields are a flat array of { id, type, ... } (shared/form/definition.ts). Email answers are
-- trimmed lowercase strings, names a string or { first, last }, phones E.164 strings
-- (shared/form/types/contact.ts); anything else is ignored.
CREATE OR REPLACE FUNCTION responses_contact_fill() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  fields jsonb;
  f jsonb;
  v jsonb;
  t text;
  em text;
  nm text;
  ph text;
BEGIN
  SELECT definition -> 'fields' INTO fields FROM form_versions WHERE id = NEW.form_version_id;
  IF jsonb_typeof(fields) = 'array' AND jsonb_typeof(NEW.answers) = 'object' THEN
    FOR f IN SELECT value FROM jsonb_array_elements(fields) LOOP
      t := f ->> 'type';
      IF t IS NULL OR t NOT IN ('email', 'name', 'phone') OR jsonb_typeof(f -> 'id') <> 'string' THEN
        CONTINUE;
      END IF;
      v := NEW.answers -> (f ->> 'id');
      IF v IS NULL THEN
        CONTINUE;
      END IF;
      IF t = 'email' AND em IS NULL AND jsonb_typeof(v) = 'string' THEN
        em := lower(btrim(v #>> '{}'));
        IF em = '' OR length(em) > 254 OR em ~ '\s' OR position('@' IN em) = 0 THEN
          em := NULL;
        END IF;
      ELSIF t = 'phone' AND ph IS NULL AND jsonb_typeof(v) = 'string' THEN
        ph := regexp_replace(v #>> '{}', '[\s().-]', '', 'g');
        IF ph !~ '^\+[1-9][0-9]{6,14}$' THEN
          ph := NULL;
        END IF;
      ELSIF t = 'name' AND nm IS NULL THEN
        IF jsonb_typeof(v) = 'string' THEN
          nm := nullif(btrim(v #>> '{}'), '');
        ELSIF jsonb_typeof(v) = 'object' THEN
          nm := nullif(concat_ws(' ', nullif(btrim(v ->> 'first'), ''), nullif(btrim(v ->> 'last'), '')), '');
        END IF;
      END IF;
      EXIT WHEN em IS NOT NULL AND nm IS NOT NULL AND ph IS NOT NULL;
    END LOOP;
  END IF;
  NEW.contact_email := em;
  NEW.contact_name := left(nm, 200);
  NEW.contact_phone := ph;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS responses_contact_fill ON responses;
CREATE TRIGGER responses_contact_fill
  BEFORE INSERT OR UPDATE OF answers, form_version_id ON responses
  FOR EACH ROW EXECUTE FUNCTION responses_contact_fill();

-- Backfill: touching answers fires the trigger.
UPDATE responses SET answers = answers;

-- Grouping, the detail page and delete: one contact's responses, newest first.
CREATE INDEX IF NOT EXISTS responses_contact_key ON responses (contact_key, submitted_at DESC) WHERE contact_key IS NOT NULL;

-- Substring search on name, email and phone. server/contacts/query.ts uses the same expression.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS responses_contact_search ON responses USING gin (
  (coalesce(contact_name, '') || ' ' || coalesce(contact_email, '') || ' ' || coalesce(contact_phone, '')) gin_trgm_ops
) WHERE contact_key IS NOT NULL;
