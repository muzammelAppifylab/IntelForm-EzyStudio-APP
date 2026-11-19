-- Contacts: one contact's responses per form, newest first (bounded per-form counts and the
-- latest responses on the detail, the delete trigger's first / last / latest-detail probes, erase).
-- Replaces responses_contact_key (dropped next): the same number of indexes on responses.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "responses_contact_form" ON "responses" ("contact_key", "form_id", "submitted_at" DESC) WHERE "contact_key" IS NOT NULL;
