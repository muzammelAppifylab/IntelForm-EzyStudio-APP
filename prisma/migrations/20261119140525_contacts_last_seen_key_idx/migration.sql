-- Contacts sorts: (value, key) scanned forward for one direction and backward for the other,
-- with a row comparison as the keyset start (src/server/intelform/contacts/sql.ts).
CREATE INDEX CONCURRENTLY IF NOT EXISTS "contacts_last_seen_key_idx" ON "contacts" ("last_seen", "key");
