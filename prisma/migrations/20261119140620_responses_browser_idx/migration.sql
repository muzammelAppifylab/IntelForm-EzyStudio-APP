-- Sorting the Responses table by browser: keyset pages walk (form_id, browser, id) instead of sorting
-- the whole form. Built CONCURRENTLY, alone, so it never blocks submits (database.md).
CREATE INDEX CONCURRENTLY IF NOT EXISTS "responses_form_id_browser_id_idx" ON "responses" ("form_id", "browser", "id");
