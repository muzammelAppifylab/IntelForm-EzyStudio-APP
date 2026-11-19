-- Empty names are read separately (name IS NULL, by key), so NULLS placement does not matter.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "contacts_name_key_idx" ON "contacts" (lower("name"), "key");
