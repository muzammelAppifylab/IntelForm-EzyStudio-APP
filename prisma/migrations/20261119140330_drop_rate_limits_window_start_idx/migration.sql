-- Only the old sweep read this index; the window-end index replaces it (one index less to keep
-- up on every public request). Dropped CONCURRENTLY, alone.
DROP INDEX CONCURRENTLY IF EXISTS "intelform_rate_limits_window_start_idx";
