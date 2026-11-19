-- Housekeeping at load (100k views/h, 30k responses/h):
--  * Notify done-markers ("this step of this job already happened") move out of
--    intelform_rate_limits into their own table with an indexed expires_at, so the rate-limit
--    sweep never steps over a week of live markers and both sweeps delete by an index range.
--    Markers still live in intelform_rate_limits are copied over; the rest of the old rows expire
--    there and the rate-limit sweep removes them (the code still reads both for a few days).
--  * intelform_window_end(): when a rate-limit window ends, IMMUTABLE so it can be indexed (the
--    index is built CONCURRENTLY in the next migration). Adding whole seconds to a timestamptz
--    doesn't depend on the time zone, so IMMUTABLE is true here.
BEGIN;

CREATE OR REPLACE FUNCTION "intelform_window_end"("start" TIMESTAMPTZ, "secs" INTEGER) RETURNS TIMESTAMPTZ
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$ SELECT $1 + make_interval(secs => $2) $$;

CREATE TABLE "intelform_done_markers" (
    "key" VARCHAR(200) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "intelform_done_markers_pkey" PRIMARY KEY ("key")
);
CREATE INDEX "intelform_done_markers_expires_at_idx" ON "intelform_done_markers"("expires_at");

-- Live markers only (job:<step>:<responseId>…, written with now() as window_start).
INSERT INTO "intelform_done_markers" ("key", "expires_at")
SELECT "key", max("window_start" + make_interval(secs => "window_seconds"))
FROM "intelform_rate_limits"
WHERE "key" LIKE 'job:%' AND "window_start" + make_interval(secs => "window_seconds") > now()
GROUP BY "key"
ON CONFLICT ("key") DO NOTHING;

COMMIT;
