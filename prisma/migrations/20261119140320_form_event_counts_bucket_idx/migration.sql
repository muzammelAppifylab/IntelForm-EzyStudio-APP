-- The hourly job folds the 16 shards of buckets older than two days into shard 0 by this index.
-- Built CONCURRENTLY, alone: every view and start beacon upserts this table.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "form_event_counts_bucket_idx" ON "form_event_counts" ("bucket");
