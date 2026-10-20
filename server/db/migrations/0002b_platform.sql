-- Platform indexes from the data benchmarks (lead). 0002_platform.sql was already applied in
-- other agents' databases, so these live in their own file. Sorts after 0002_, before 0003_.
-- sessions (expires_at) already exists as sessions_expiry (0002_platform.sql).

CREATE INDEX IF NOT EXISTS password_resets_user ON password_resets (user_id);
CREATE INDEX IF NOT EXISTS password_resets_expires ON password_resets (expires_at);
-- FK with ON DELETE SET NULL: without it, bulk response deletes took 17 s instead of 1.8 s.
CREATE INDEX IF NOT EXISTS webhook_deliveries_response ON webhook_deliveries (response_id);
CREATE INDEX IF NOT EXISTS form_events_created ON form_events (created_at);
