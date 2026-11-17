BEGIN;

-- ---------------------------------------------------------------------------
-- Exports never outlive the responses in them (F-010). Every way a response goes (one, a
-- selection, a contact erase, retention, a deleted form's cascade) passes through this
-- statement-level trigger: each export that may hold a deleted response stops being
-- downloadable and its stored parts go, in the same transaction as the delete.
--   responses  exports of the forms the deleted responses were on
--   contacts   every contacts export, when a deleted response belonged to a contact
--   all        every all-responses ZIP
-- Running exports stop too (the job finds them failed and does nothing); the person starts a
-- new one, which reads only what is left.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "responses_exports_invalidate"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  hit uuid[];
BEGIN
  WITH failed AS (
    UPDATE intelform_exports e SET
      status = 'failed',
      error = 'Responses in this export were deleted after it started. Start the export again.',
      state = '{}'::jsonb,
      updated_at = now()
    WHERE e.status IN ('running', 'ready')
      AND (
        e.kind = 'all'
        OR (e.kind = 'responses' AND e.form_id IN (SELECT DISTINCT form_id FROM gone_exports))
        OR (e.kind = 'contacts' AND EXISTS (SELECT 1 FROM gone_exports WHERE contact_key IS NOT NULL))
      )
    RETURNING e.id
  )
  SELECT coalesce(array_agg(id), '{}') INTO hit FROM failed;
  IF cardinality(hit) > 0 THEN
    DELETE FROM intelform_export_parts WHERE export_id = ANY(hit);
  END IF;
  RETURN NULL;
END
$$;

DROP TRIGGER IF EXISTS "responses_exports_invalidate" ON "responses";
CREATE TRIGGER "responses_exports_invalidate" AFTER DELETE ON "responses"
  REFERENCING OLD TABLE AS gone_exports FOR EACH STATEMENT EXECUTE FUNCTION "responses_exports_invalidate"();

-- The hourly maintenance finds exports whose job stopped (F-025) by their last progress.
CREATE INDEX IF NOT EXISTS "intelform_exports_status_updated_at_idx" ON "intelform_exports"("status", "updated_at");

COMMIT;
