CREATE INDEX CONCURRENTLY IF NOT EXISTS "contacts_first_seen_key_idx" ON "contacts" ("first_seen", "key");
