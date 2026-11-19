-- Performance (an idle site costs almost nothing; a submit writes less and never queues on a
-- contact's row):
--  * intelform_dirty_forms: forms whose counters (`c`) or Summary rollups (`s` responses, `e`
--    funnel events) may be out of date, one row per kind, minute and form. The responses insert
--    and delete triggers and the events beacon add them with ON CONFLICT DO NOTHING (no lock when
--    the minute's row is there). The jobs look only at these forms, never at every form.
--  * intelform_contact_queue: the contacts rollup moves off the submit. The insert trigger adds a
--    row per response with a contact (a new row, never an update of the contact's row); the
--    notify job and the contacts screens fold the queue into `contacts` (intelform_contacts_apply),
--    in key order, a batch at a time. A delete, an update or a rebuild of a key applies or drops
--    its queued rows first, so `contacts` is exact whenever it is read through the app.
--  * intelform_export_parts holds file ids, no bytes: the export files live in the platform's
--    file storage. Deleting a part (the 24-hour sweep, a failed export, a deleted form) puts its
--    file in intelform_file_trash, which the file cleanup removes.
BEGIN;

CREATE TABLE "intelform_dirty_forms" (
    "kind" CHAR(1) NOT NULL,
    "bucket" TIMESTAMPTZ(0) NOT NULL,
    "form_id" UUID NOT NULL,

    CONSTRAINT "intelform_dirty_forms_pkey" PRIMARY KEY ("kind", "bucket", "form_id")
);
ALTER TABLE "intelform_dirty_forms" ADD CONSTRAINT "intelform_dirty_forms_kind_check" CHECK ("kind" IN ('c', 's', 'e'));

-- Every form starts dirty once, so the first runs bring every copy and rollup up to date.
INSERT INTO "intelform_dirty_forms" ("kind", "bucket", "form_id")
SELECT k.kind, date_trunc('minute', now() - interval '1 hour'), f.id FROM "forms" f, (VALUES ('c'), ('s'), ('e')) AS k(kind)
ON CONFLICT DO NOTHING;

CREATE TABLE "intelform_contact_queue" (
    "id" BIGSERIAL NOT NULL,
    "key" VARCHAR(260) NOT NULL,
    "form_id" UUID NOT NULL,
    "submitted_at" TIMESTAMPTZ(3) NOT NULL,
    "email" VARCHAR(254),
    "name" VARCHAR(200),
    "phone" VARCHAR(20),
    "country" VARCHAR(2),

    CONSTRAINT "intelform_contact_queue_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "intelform_contact_queue_key_id_idx" ON "intelform_contact_queue"("key", "id");

-- Folds queued contact rows into `contacts` (the rollup the insert trigger used to do), `lim` rows
-- at most, oldest first; only those of `keys` when given (NULL: any). Rows another run holds are
-- skipped (it applies them). Returns how many rows were applied.
CREATE OR REPLACE FUNCTION "intelform_contacts_apply"(keys text[], lim int) RETURNS int
LANGUAGE plpgsql AS $$
DECLARE
  n int;
BEGIN
  WITH taken AS (
    DELETE FROM intelform_contact_queue q WHERE q.id IN (
      SELECT id FROM intelform_contact_queue
      WHERE keys IS NULL OR key = ANY(keys)
      ORDER BY id LIMIT lim
      FOR UPDATE SKIP LOCKED
    )
    RETURNING q.id, q.key, q.form_id, q.submitted_at, q.email, q.name, q.phone, q.country
  ),
  up AS (
    INSERT INTO contacts AS c (key, n, first_seen, last_seen, email, name, phone, country, form_ids, form_count)
    SELECT g.key, g.n, g.first_seen, g.last_seen, g.email, g.name, g.phone, g.country, g.form_ids, cardinality(g.form_ids)
    FROM (
      SELECT key, count(*)::int AS n, min(submitted_at) AS first_seen, max(submitted_at) AS last_seen,
        (array_agg(email ORDER BY submitted_at DESC, id DESC) FILTER (WHERE email IS NOT NULL))[1] AS email,
        (array_agg(name ORDER BY submitted_at DESC, id DESC) FILTER (WHERE name IS NOT NULL))[1] AS name,
        (array_agg(phone ORDER BY submitted_at DESC, id DESC) FILTER (WHERE phone IS NOT NULL))[1] AS phone,
        (array_agg(country ORDER BY submitted_at DESC, id DESC) FILTER (WHERE country IS NOT NULL))[1] AS country,
        intelform_uniq_uuids(array_agg(form_id ORDER BY submitted_at DESC, id DESC)) AS form_ids
      FROM taken
      GROUP BY key
    ) g
    ORDER BY g.key
    ON CONFLICT (key) DO UPDATE SET
      n = c.n + EXCLUDED.n,
      first_seen = least(c.first_seen, EXCLUDED.first_seen),
      last_seen = greatest(c.last_seen, EXCLUDED.last_seen),
      email = CASE WHEN EXCLUDED.last_seen >= c.last_seen THEN coalesce(EXCLUDED.email, c.email) ELSE coalesce(c.email, EXCLUDED.email) END,
      name = CASE WHEN EXCLUDED.last_seen >= c.last_seen THEN coalesce(EXCLUDED.name, c.name) ELSE coalesce(c.name, EXCLUDED.name) END,
      phone = CASE WHEN EXCLUDED.last_seen >= c.last_seen THEN coalesce(EXCLUDED.phone, c.phone) ELSE coalesce(c.phone, EXCLUDED.phone) END,
      country = CASE WHEN EXCLUDED.last_seen >= c.last_seen THEN coalesce(EXCLUDED.country, c.country) ELSE coalesce(c.country, EXCLUDED.country) END,
      form_ids = CASE
        WHEN c.form_ids[1:cardinality(EXCLUDED.form_ids)] = EXCLUDED.form_ids THEN c.form_ids
        WHEN EXCLUDED.last_seen >= c.last_seen THEN intelform_uniq_uuids(EXCLUDED.form_ids || c.form_ids)
        ELSE intelform_uniq_uuids(c.form_ids || EXCLUDED.form_ids) END,
      form_count = cardinality(CASE
        WHEN c.form_ids[1:cardinality(EXCLUDED.form_ids)] = EXCLUDED.form_ids THEN c.form_ids
        ELSE intelform_uniq_uuids(c.form_ids || EXCLUDED.form_ids) END)
    RETURNING 1
  )
  SELECT (SELECT count(*)::int FROM taken) + 0 * (SELECT count(*) FROM up) INTO n;
  RETURN n;
END
$$;

-- The insert trigger: the contact goes to the queue (a new row), then the form's shards, then
-- the dirty markers (no lock when the minute's row is already there).
CREATE OR REPLACE FUNCTION "responses_rollups_insert"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  s smallint := floor(random() * 16)::smallint;
BEGIN
  INSERT INTO intelform_contact_queue (key, form_id, submitted_at, email, name, phone, country)
  SELECT contact_key, form_id, submitted_at, contact_email, contact_name, contact_phone, country
  FROM ins WHERE contact_key IS NOT NULL;

  INSERT INTO form_counts AS fc (form_id, shard, responses, last_response_at)
  SELECT form_id, s, count(*)::int, max(submitted_at) FROM ins GROUP BY 1
  ON CONFLICT (form_id, shard) DO UPDATE SET
    responses = fc.responses + EXCLUDED.responses,
    last_response_at = greatest(fc.last_response_at, EXCLUDED.last_response_at);

  INSERT INTO form_response_hours AS h (form_id, hour, shard, n)
  SELECT form_id, date_trunc('hour', submitted_at), s, count(*)::int FROM ins GROUP BY 1, 2
  ON CONFLICT (form_id, hour, shard) DO UPDATE SET n = h.n + EXCLUDED.n;

  -- Counts: the minute of the insert. The Summary: the minute of the newest response it added
  -- (now() for a submit; an import's older responses can be added up at once).
  INSERT INTO intelform_dirty_forms (kind, bucket, form_id)
  SELECT k.kind, CASE WHEN k.kind = 'c' THEN date_trunc('minute', now()) ELSE date_trunc('minute', least(i.last_at, now())) END, i.form_id
  FROM (SELECT form_id, max(submitted_at) AS last_at FROM ins GROUP BY form_id) i, (VALUES ('c'), ('s')) AS k(kind)
  ON CONFLICT DO NOTHING;
  RETURN NULL;
END
$$;

-- Deletes change the counts (the Summary's own delete trigger keeps its rollups right).
CREATE OR REPLACE FUNCTION "responses_dirty_delete"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO intelform_dirty_forms (kind, bucket, form_id)
  SELECT DISTINCT 'c', date_trunc('minute', now()), g.form_id FROM gone_dirty g
  ON CONFLICT DO NOTHING;
  RETURN NULL;
END
$$;
DROP TRIGGER IF EXISTS "responses_dirty_delete" ON "responses";
CREATE TRIGGER "responses_dirty_delete" AFTER DELETE ON "responses"
  REFERENCING OLD TABLE AS gone_dirty FOR EACH STATEMENT EXECUTE FUNCTION "responses_dirty_delete"();

-- Before a delete is taken off its contacts (responses_contacts_delete; AFTER statement triggers
-- run in name order, and "apply" sorts before "delete"): the queued rows of those keys go into
-- `contacts` first, so what is subtracted was added.
CREATE OR REPLACE FUNCTION "responses_contacts_apply"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  keys text[];
BEGIN
  SELECT coalesce(array_agg(DISTINCT contact_key ORDER BY contact_key), '{}') INTO keys
  FROM gone_apply WHERE contact_key IS NOT NULL;
  IF cardinality(keys) > 0 AND EXISTS (SELECT 1 FROM intelform_contact_queue WHERE key = ANY(keys)) THEN
    PERFORM intelform_contacts_apply(keys, 2147483647);
  END IF;
  RETURN NULL;
END
$$;
DROP TRIGGER IF EXISTS "responses_contacts_apply" ON "responses";
CREATE TRIGGER "responses_contacts_apply" AFTER DELETE ON "responses"
  REFERENCING OLD TABLE AS gone_apply FOR EACH STATEMENT EXECUTE FUNCTION "responses_contacts_apply"();

-- A rebuild recomputes keys from every response they have: their queued rows are counted in it,
-- so they go first (applied later they would count twice).
CREATE OR REPLACE FUNCTION "intelform_contacts_rebuild"(keys text[]) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF keys IS NULL OR cardinality(keys) = 0 THEN
    RETURN;
  END IF;
  DELETE FROM intelform_contact_queue WHERE key = ANY(keys);
  DELETE FROM contacts c WHERE c.key = ANY(keys)
    AND NOT EXISTS (SELECT 1 FROM responses r WHERE r.contact_key = c.key);
  INSERT INTO contacts AS c (key, n, first_seen, last_seen, email, name, phone, country, form_ids, form_count)
  SELECT r.contact_key, count(*)::int, min(r.submitted_at), max(r.submitted_at),
    (array_agg(r.contact_email ORDER BY r.submitted_at DESC, r.id DESC) FILTER (WHERE r.contact_email IS NOT NULL))[1],
    (array_agg(r.contact_name ORDER BY r.submitted_at DESC, r.id DESC) FILTER (WHERE r.contact_name IS NOT NULL))[1],
    (array_agg(r.contact_phone ORDER BY r.submitted_at DESC, r.id DESC) FILTER (WHERE r.contact_phone IS NOT NULL))[1],
    (array_agg(r.country ORDER BY r.submitted_at DESC, r.id DESC) FILTER (WHERE r.country IS NOT NULL))[1],
    intelform_uniq_uuids(array_agg(r.form_id ORDER BY r.submitted_at DESC, r.id DESC)),
    count(DISTINCT r.form_id)::int
  FROM responses r
  WHERE r.contact_key = ANY(keys)
  GROUP BY r.contact_key
  ORDER BY r.contact_key
  ON CONFLICT (key) DO UPDATE SET
    n = EXCLUDED.n, first_seen = EXCLUDED.first_seen, last_seen = EXCLUDED.last_seen,
    email = EXCLUDED.email, name = EXCLUDED.name, phone = EXCLUDED.phone, country = EXCLUDED.country,
    form_ids = EXCLUDED.form_ids, form_count = EXCLUDED.form_count;
END
$$;

-- Export files: ids only. Exports built before this have no files: they stop (start again).
UPDATE "intelform_exports" SET "status" = 'failed', "error" = 'The export didn’t finish. Try again.', "state" = '{}'::jsonb, "updated_at" = now()
WHERE "status" <> 'failed';
DELETE FROM "intelform_export_parts";
ALTER TABLE "intelform_export_parts" DROP COLUMN "data",
ADD COLUMN "file_id" VARCHAR(64) NOT NULL,
ADD COLUMN "size" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "ready" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE OR REPLACE FUNCTION "intelform_export_parts_trash"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO intelform_file_trash (file_id)
  SELECT DISTINCT file_id FROM gone_parts WHERE file_id ~ '^[A-Za-z0-9_-]{1,128}$'
  ON CONFLICT (file_id) DO NOTHING;
  RETURN NULL;
END
$$;
DROP TRIGGER IF EXISTS "intelform_export_parts_trash" ON "intelform_export_parts";
CREATE TRIGGER "intelform_export_parts_trash" AFTER DELETE ON "intelform_export_parts"
  REFERENCING OLD TABLE AS gone_parts FOR EACH STATEMENT EXECUTE FUNCTION "intelform_export_parts_trash"();

-- An UPDATE that swaps a part's file (a run that repeats) trashes the file it replaced.
CREATE OR REPLACE FUNCTION "intelform_export_parts_retrash"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO intelform_file_trash (file_id)
  SELECT DISTINCT o.file_id FROM old_parts o JOIN new_parts n ON n.export_id = o.export_id AND n.seq = o.seq
  WHERE o.file_id <> n.file_id AND o.file_id ~ '^[A-Za-z0-9_-]{1,128}$'
  ON CONFLICT (file_id) DO NOTHING;
  RETURN NULL;
END
$$;
DROP TRIGGER IF EXISTS "intelform_export_parts_retrash" ON "intelform_export_parts";
CREATE TRIGGER "intelform_export_parts_retrash" AFTER UPDATE ON "intelform_export_parts"
  REFERENCING OLD TABLE AS old_parts NEW TABLE AS new_parts FOR EACH STATEMENT EXECUTE FUNCTION "intelform_export_parts_retrash"();

COMMIT;
