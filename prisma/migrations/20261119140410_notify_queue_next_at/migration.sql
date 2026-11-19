-- The drain's claim: due rows, oldest due first. Built CONCURRENTLY, alone, so it never blocks the
-- submits that insert into the queue (database.md).
CREATE INDEX CONCURRENTLY IF NOT EXISTS "intelform_notify_queue_next_at_idx" ON "intelform_notify_queue" ("next_at");
