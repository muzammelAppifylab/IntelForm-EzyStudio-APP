-- Forms management (Agent D), part 2. 0003_forms.sql was already applied in other databases,
-- so these additions live in their own file. (form_slugs_old_form and responses_form_version,
-- also asked for here, are already in 0003_forms.sql.)

-- Denormalised counters: the forms list reads these instead of a GROUP BY over responses.
-- The submit route (Agent E) and the response delete routes (Agent G) keep them current.
ALTER TABLE forms
  ADD COLUMN response_count integer NOT NULL DEFAULT 0,
  ADD COLUMN last_response_at timestamptz;

UPDATE forms f SET response_count = r.n, last_response_at = r.last
FROM (SELECT form_id, count(*)::int AS n, max(submitted_at) AS last FROM responses GROUP BY form_id) r
WHERE r.form_id = f.id;

CREATE INDEX forms_response_count ON forms (response_count DESC, updated_at DESC);

-- sha256 of a built-in template's canonical JSON: re-seeding only writes rows that changed.
ALTER TABLE templates ADD COLUMN builtin_hash text;
