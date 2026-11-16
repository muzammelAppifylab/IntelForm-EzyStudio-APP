-- Responses and analytics (Agent G). See docs/research/05-data-analytics.md "DDL", block 0004_responses.
-- Idempotent where other migrations touch the same objects: 0003 (D) already indexes
-- responses(form_version_id) and adds forms.response_count; 0006 (E) may create search_text, ttc and
-- form_event_counts IF NOT EXISTS. This file sorts first, so it creates them and E's statements no-op.

-- Default table sort and keyset pagination: (form_id, submitted_at DESC, id DESC). Without id,
-- Postgres adds a sort step for the tie-breaker.
DROP INDEX IF EXISTS responses_form_submitted;
CREATE INDEX IF NOT EXISTS responses_form_submitted ON responses (form_id, submitted_at DESC, id DESC);

-- Answers are always a { fieldId: value } object (summary queries rely on jsonb_each / jsonb_object_keys).
ALTER TABLE responses DROP CONSTRAINT IF EXISTS responses_answers_object;
ALTER TABLE responses ADD CONSTRAINT responses_answers_object CHECK (jsonb_typeof(answers) = 'object');

-- Search across text answers: a server-built string (name, email, phone, url, short and long text,
-- address, "Other" text) with a trigram index for substring / ILIKE matches.
ALTER TABLE responses ADD COLUMN IF NOT EXISTS search_text text NOT NULL DEFAULT '';
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS responses_search_trgm ON responses USING gin (search_text gin_trgm_ops);

-- Per-question time to complete, measured in the browser: { fieldId: ms }. Null for old responses.
ALTER TABLE responses ADD COLUMN IF NOT EXISTS ttc jsonb;

-- One response per browser checks, and date-range scans across forms.
CREATE INDEX IF NOT EXISTS responses_browser ON responses (form_id, browser_token) WHERE browser_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS responses_submitted_brin ON responses USING brin (submitted_at);

-- Funnel rollup: 15-minute buckets give correct day boundaries in every time zone (+5:30, +5:45 too).
CREATE TABLE IF NOT EXISTS form_event_counts (
  form_id  uuid NOT NULL REFERENCES forms (id) ON DELETE CASCADE,
  bucket   timestamptz NOT NULL,
  views    integer NOT NULL DEFAULT 0,
  starts   integer NOT NULL DEFAULT 0,
  PRIMARY KEY (form_id, bucket)
);
CREATE INDEX IF NOT EXISTS form_events_created_brin ON form_events USING brin (created_at);

-- Backfill the rollup from any raw events recorded before it existed.
INSERT INTO form_event_counts (form_id, bucket, views, starts)
SELECT form_id, date_bin('15 minutes', created_at, '2000-01-01'),
       count(*) FILTER (WHERE type = 'view'), count(*) FILTER (WHERE type = 'start')
FROM form_events GROUP BY 1, 2
ON CONFLICT (form_id, bucket) DO NOTHING;

-- Responses table columns per user and form: ordered [{ "id": "submitted_at", "visible": true }, …].
CREATE TABLE IF NOT EXISTS response_table_prefs (
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  form_id     uuid NOT NULL REFERENCES forms (id) ON DELETE CASCADE,
  columns     jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, form_id)
);
CREATE INDEX IF NOT EXISTS response_table_prefs_form ON response_table_prefs (form_id);
