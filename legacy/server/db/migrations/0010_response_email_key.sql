-- One response per email: the dedupe key of the checked answer, stored at submit
-- (server/respondent/submit.ts) so the check is an index lookup, not a scan of the form's
-- responses. The unique index is what stops two simultaneous submits with the same address.
ALTER TABLE responses ADD COLUMN IF NOT EXISTS email_key text;

-- Backfill on forms that name an email question, with the normalisation of emailDedupeKey
-- (shared/form/logic.ts): lowercase, trimmed, `+tag` dropped from the local part. Only the
-- earliest response per address gets the key: repeats sent while the check was off stay null,
-- so the unique index builds.
UPDATE responses r SET email_key = k.key
FROM (
  SELECT DISTINCT ON (r.form_id, x.key) r.id, x.key
  FROM responses r
  JOIN forms f ON f.id = r.form_id
  CROSS JOIN LATERAL (
    SELECT regexp_replace(lower(btrim(r.answers->>(f.settings->>'onePerEmailFieldId'))), '^([^@+]+)[+][^@]*@', '\1@') AS key
  ) x
  WHERE f.settings->>'onePerEmailFieldId' IS NOT NULL AND x.key <> ''
  ORDER BY r.form_id, x.key, r.submitted_at, r.id
) k
WHERE r.id = k.id;

CREATE UNIQUE INDEX IF NOT EXISTS responses_email_key ON responses (form_id, email_key) WHERE email_key IS NOT NULL;
