-- The notify queue's drain, faster and kinder to the site's email limits:
--  * intelform_notify_queue.next_at: when a row may be taken (now for a new row; after its back-off
--    for a failed one). The claim reads only due rows, oldest due first, instead of re-scanning
--    every row in its back-off. Its index is built alone, CONCURRENTLY (next folder).
--  * intelform_notify_hours: per form per hour, how many responses were emailed one by one, how
--    many wait for the hourly digest (and how many of those the digest has covered), and how many
--    confirmations the hourly cap held back (shown to the owner in the form's settings).
BEGIN;

ALTER TABLE "intelform_notify_queue" ADD COLUMN "next_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Backfill: a row never claimed is due when it was queued; a claimed one after its back-off.
UPDATE "intelform_notify_queue" SET "next_at" = CASE
  WHEN "claimed_at" IS NULL THEN "created_at"
  ELSE "claimed_at" + make_interval(mins => CASE
    WHEN "attempts" <= 1 THEN 2 WHEN "attempts" = 2 THEN 5 WHEN "attempts" = 3 THEN 15 ELSE 60 END)
END;

CREATE TABLE "intelform_notify_hours" (
    "form_id" UUID NOT NULL,
    "hour" TIMESTAMPTZ(3) NOT NULL,
    "notified" INTEGER NOT NULL DEFAULT 0,
    "digest_pending" INTEGER NOT NULL DEFAULT 0,
    "digest_sent" INTEGER NOT NULL DEFAULT 0,
    "confirmed" INTEGER NOT NULL DEFAULT 0,
    "confirm_capped" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "intelform_notify_hours_pkey" PRIMARY KEY ("form_id", "hour")
);
CREATE INDEX "intelform_notify_hours_hour_idx" ON "intelform_notify_hours"("hour");
ALTER TABLE "intelform_notify_hours" ADD CONSTRAINT "intelform_notify_hours_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
