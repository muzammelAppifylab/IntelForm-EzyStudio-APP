BEGIN;

-- The Activity screen filters the log by kind (a set of actions) and by date, newest first.
CREATE INDEX IF NOT EXISTS "audit_events_action_id_idx" ON "audit_events" ("action", "id");
CREATE INDEX IF NOT EXISTS "audit_events_created_at_idx" ON "audit_events" ("created_at");

COMMIT;
