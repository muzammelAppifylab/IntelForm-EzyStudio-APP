-- Sorting the Responses table by duration_ms: keyset pages walk (form_id, duration_ms, id) instead of sorting
-- the whole form. Built CONCURRENTLY, alone, so it never blocks submits (database.md).
CREATE INDEX CONCURRENTLY IF NOT EXISTS "responses_form_id_duration_ms_id_idx" ON "responses" ("form_id", "duration_ms", "id");
