-- Respondent (Agent E): columns the submit route writes and the funnel rollup.
-- search_text and form_event_counts belong to 0004_responses (Agent G); they are created here
-- only IF NOT EXISTS, with the same DDL (docs/research/05-data-analytics.md), so the submit route
-- works whichever migration lands first.

-- Time to complete per field, measured in the browser: { "f_x": 5120, … } in milliseconds.
ALTER TABLE responses ADD COLUMN IF NOT EXISTS ttc jsonb;

ALTER TABLE responses ADD COLUMN IF NOT EXISTS search_text text NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS form_event_counts (
  form_id  uuid NOT NULL REFERENCES forms (id) ON DELETE CASCADE,
  bucket   timestamptz NOT NULL,
  views    integer NOT NULL DEFAULT 0,
  starts   integer NOT NULL DEFAULT 0,
  PRIMARY KEY (form_id, bucket)
);

-- One-response-per-browser lookups.
CREATE INDEX IF NOT EXISTS responses_browser ON responses (form_id, browser_token) WHERE browser_token IS NOT NULL;
