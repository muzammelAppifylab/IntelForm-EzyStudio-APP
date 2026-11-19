-- One response per (form, submission id): a retried submit is saved once. Built CONCURRENTLY,
-- alone, so it never blocks submits while it scans the responses table (database.md).
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "responses_submission_key" ON "responses" ("form_id", "submission_id") WHERE "submission_id" IS NOT NULL;
