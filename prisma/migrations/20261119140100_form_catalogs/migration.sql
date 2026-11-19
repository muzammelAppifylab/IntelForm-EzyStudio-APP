BEGIN;

-- ---------------------------------------------------------------------------
-- The responses field catalog, precomputed (src/server/intelform/responses/catalog.ts). Every
-- responses page, drawer, Summary and export step read every version's whole definition to build
-- it; now publish merges the previous catalog with the new version and readers read this one row.
-- `version_id` is the published version it was built for: a row that doesn't match the form's
-- published version is rebuilt on its first read (forms published before this migration too, so
-- there is no backfill here: the merge needs the app's field parsing).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "form_catalogs" (
    "form_id" UUID NOT NULL,
    "version_id" UUID,
    "catalog" JSONB NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "form_catalogs_pkey" PRIMARY KEY ("form_id")
);
ALTER TABLE "form_catalogs" DROP CONSTRAINT IF EXISTS "form_catalogs_form_id_fkey";
ALTER TABLE "form_catalogs" ADD CONSTRAINT "form_catalogs_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Exports: a run's number (the next run's job key) and "the next run wasn't queued": a refused
-- send no longer fails the export; the every-minute job sends it again (exports/job.ts
-- resendPendingExports). Constant defaults: no table rewrite.
-- ---------------------------------------------------------------------------
ALTER TABLE "intelform_exports" ADD COLUMN IF NOT EXISTS "runs" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "intelform_exports" ADD COLUMN IF NOT EXISTS "send_pending" BOOLEAN NOT NULL DEFAULT false;

COMMIT;
