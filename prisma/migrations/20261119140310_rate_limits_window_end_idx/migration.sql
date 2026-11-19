-- The rate-limit sweep deletes ended windows by this index (no filter stepping over live rows).
-- Built CONCURRENTLY, alone: the table takes an upsert per public request.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "intelform_rate_limits_window_end_idx" ON "intelform_rate_limits" ("intelform_window_end"("window_start", "window_seconds"));
