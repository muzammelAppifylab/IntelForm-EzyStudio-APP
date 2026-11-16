-- IntelForm review fixes: rollups kept on write (contacts, hourly response counts, all-time
-- starts), a trash for stored files of deleted responses, and background exports.
-- Everything is kept up to date by triggers in the same statement as the write, so no request
-- aggregates the responses table to show a list, a tile or a strip.

-- ---------------------------------------------------------------------------
-- forms.starts_total: all-time starts (the 15-minute buckets are never summed per request).
-- ---------------------------------------------------------------------------
ALTER TABLE "forms" ADD COLUMN "starts_total" INTEGER NOT NULL DEFAULT 0;
UPDATE "forms" f SET "starts_total" = e.n
FROM (SELECT "form_id", sum("starts")::int AS n FROM "form_event_counts" GROUP BY "form_id") e
WHERE e."form_id" = f."id";
ALTER TABLE "forms" ADD CONSTRAINT "forms_starts_total_check" CHECK ("starts_total" >= 0);

-- ---------------------------------------------------------------------------
-- Responses per form per hour (the dashboard strip, "new this week", most active forms).
-- ---------------------------------------------------------------------------
CREATE TABLE "form_response_hours" (
    "form_id" UUID NOT NULL,
    "hour" TIMESTAMPTZ(3) NOT NULL,
    "n" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "form_response_hours_pkey" PRIMARY KEY ("form_id","hour")
);
CREATE INDEX "form_response_hours_hour_idx" ON "form_response_hours"("hour");
ALTER TABLE "form_response_hours" ADD CONSTRAINT "form_response_hours_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "form_response_hours" ("form_id", "hour", "n")
SELECT "form_id", date_trunc('hour', "submitted_at"), count(*)::int
FROM "responses" WHERE "submitted_at" >= now() - interval '35 days'
GROUP BY 1, 2;

-- ---------------------------------------------------------------------------
-- Contacts: one row per contact_key, kept by the triggers below (insert: added in; delete or a
-- change of the contact columns: that contact recomputed from its own responses, by index).
-- ---------------------------------------------------------------------------
CREATE TABLE "contacts" (
    "key" VARCHAR(260) NOT NULL,
    "n" INTEGER NOT NULL,
    "first_seen" TIMESTAMPTZ(3) NOT NULL,
    "last_seen" TIMESTAMPTZ(3) NOT NULL,
    "email" VARCHAR(254),
    "name" VARCHAR(200),
    "phone" VARCHAR(20),
    "country" VARCHAR(2),
    "form_ids" UUID[] NOT NULL DEFAULT '{}',
    "form_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("key")
);
-- One index per sort (keyset: the sort value, then the latest activity, then the key).
CREATE INDEX "contacts_last_seen_idx" ON "contacts"("last_seen" DESC, "key");
CREATE INDEX "contacts_first_seen_idx" ON "contacts"("first_seen" DESC, "last_seen" DESC, "key");
CREATE INDEX "contacts_name_idx" ON "contacts"(lower("name"), "last_seen" DESC, "key");
CREATE INDEX "contacts_email_idx" ON "contacts"("email", "last_seen" DESC, "key");
CREATE INDEX "contacts_n_idx" ON "contacts"("n" DESC, "last_seen" DESC, "key");
CREATE INDEX "contacts_country_idx" ON "contacts"("country");
CREATE INDEX "contacts_form_ids_idx" ON "contacts" USING gin ("form_ids");
-- Search: the same expression as src/server/intelform/contacts/sql.ts SEARCH_EXPR.
CREATE INDEX "contacts_search_trgm" ON "contacts" USING gin (
  (coalesce("name", '') || ' ' || coalesce("email", '') || ' ' || coalesce("phone", '')) gin_trgm_ops
);

-- Recomputes some contacts from their responses (responses_contact_key index); a key with no
-- response left goes.
CREATE OR REPLACE FUNCTION "intelform_contacts_refresh"(keys text[]) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF keys IS NULL OR cardinality(keys) = 0 THEN
    RETURN;
  END IF;
  DELETE FROM contacts c WHERE c.key = ANY(keys)
    AND NOT EXISTS (SELECT 1 FROM responses r WHERE r.contact_key = c.key);
  INSERT INTO contacts AS c (key, n, first_seen, last_seen, email, name, phone, country, form_ids, form_count)
  SELECT r.contact_key, count(*)::int, min(r.submitted_at), max(r.submitted_at),
    (array_agg(r.contact_email ORDER BY r.submitted_at DESC, r.id DESC) FILTER (WHERE r.contact_email IS NOT NULL))[1],
    (array_agg(r.contact_name ORDER BY r.submitted_at DESC, r.id DESC) FILTER (WHERE r.contact_name IS NOT NULL))[1],
    (array_agg(r.contact_phone ORDER BY r.submitted_at DESC, r.id DESC) FILTER (WHERE r.contact_phone IS NOT NULL))[1],
    (array_agg(r.country ORDER BY r.submitted_at DESC, r.id DESC) FILTER (WHERE r.country IS NOT NULL))[1],
    array_agg(DISTINCT r.form_id), count(DISTINCT r.form_id)::int
  FROM responses r
  WHERE r.contact_key = ANY(keys)
  GROUP BY r.contact_key
  ON CONFLICT (key) DO UPDATE SET
    n = EXCLUDED.n, first_seen = EXCLUDED.first_seen, last_seen = EXCLUDED.last_seen,
    email = EXCLUDED.email, name = EXCLUDED.name, phone = EXCLUDED.phone, country = EXCLUDED.country,
    form_ids = EXCLUDED.form_ids, form_count = EXCLUDED.form_count;
END
$$;

-- Backfill from the responses already there.
SELECT "intelform_contacts_refresh"(ARRAY(SELECT DISTINCT "contact_key" FROM "responses" WHERE "contact_key" IS NOT NULL));

-- ---------------------------------------------------------------------------
-- Stored files (signatures) of deleted responses, removed from storage by the
-- intelform-file-cleanup job a few at a time. Every way a response goes (one, many, a contact
-- erase, retention, a deleted form) passes through the delete trigger below.
-- ---------------------------------------------------------------------------
CREATE TABLE "intelform_file_trash" (
    "file_id" VARCHAR(128) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "intelform_file_trash_pkey" PRIMARY KEY ("file_id")
);
CREATE INDEX "intelform_file_trash_created_at_idx" ON "intelform_file_trash"("created_at");

-- ---------------------------------------------------------------------------
-- The triggers on responses (statement level: one pass per statement, also for the deletes a
-- deleted form cascades to).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "responses_rollups_insert"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO form_response_hours AS h (form_id, hour, n)
  SELECT form_id, date_trunc('hour', submitted_at), count(*)::int FROM ins GROUP BY 1, 2
  ON CONFLICT (form_id, hour) DO UPDATE SET n = h.n + EXCLUDED.n;

  INSERT INTO contacts AS c (key, n, first_seen, last_seen, email, name, phone, country, form_ids, form_count)
  SELECT contact_key, count(*)::int, min(submitted_at), max(submitted_at),
    (array_agg(contact_email ORDER BY submitted_at DESC, id DESC) FILTER (WHERE contact_email IS NOT NULL))[1],
    (array_agg(contact_name ORDER BY submitted_at DESC, id DESC) FILTER (WHERE contact_name IS NOT NULL))[1],
    (array_agg(contact_phone ORDER BY submitted_at DESC, id DESC) FILTER (WHERE contact_phone IS NOT NULL))[1],
    (array_agg(country ORDER BY submitted_at DESC, id DESC) FILTER (WHERE country IS NOT NULL))[1],
    array_agg(DISTINCT form_id), count(DISTINCT form_id)::int
  FROM ins WHERE contact_key IS NOT NULL
  GROUP BY contact_key
  ON CONFLICT (key) DO UPDATE SET
    n = c.n + EXCLUDED.n,
    first_seen = least(c.first_seen, EXCLUDED.first_seen),
    last_seen = greatest(c.last_seen, EXCLUDED.last_seen),
    email = CASE WHEN EXCLUDED.last_seen >= c.last_seen THEN coalesce(EXCLUDED.email, c.email) ELSE coalesce(c.email, EXCLUDED.email) END,
    name = CASE WHEN EXCLUDED.last_seen >= c.last_seen THEN coalesce(EXCLUDED.name, c.name) ELSE coalesce(c.name, EXCLUDED.name) END,
    phone = CASE WHEN EXCLUDED.last_seen >= c.last_seen THEN coalesce(EXCLUDED.phone, c.phone) ELSE coalesce(c.phone, EXCLUDED.phone) END,
    country = CASE WHEN EXCLUDED.last_seen >= c.last_seen THEN coalesce(EXCLUDED.country, c.country) ELSE coalesce(c.country, EXCLUDED.country) END,
    form_ids = ARRAY(SELECT DISTINCT x FROM unnest(c.form_ids || EXCLUDED.form_ids) AS x),
    form_count = cardinality(ARRAY(SELECT DISTINCT x FROM unnest(c.form_ids || EXCLUDED.form_ids) AS x));
  RETURN NULL;
END
$$;

CREATE OR REPLACE FUNCTION "responses_rollups_delete"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE form_response_hours h SET n = GREATEST(h.n - d.n, 0)
  FROM (SELECT form_id, date_trunc('hour', submitted_at) AS hour, count(*)::int AS n FROM gone GROUP BY 1, 2) d
  WHERE h.form_id = d.form_id AND h.hour = d.hour;

  PERFORM intelform_contacts_refresh(ARRAY(SELECT DISTINCT contact_key FROM gone WHERE contact_key IS NOT NULL));

  -- Signature answers only: an object holding just {fileId} (or the older {url} of a file this
  -- site stored). The submit route writes these itself; a respondent never sends a file id.
  INSERT INTO intelform_file_trash (file_id)
  SELECT DISTINCT x.fid FROM gone g, LATERAL (
    SELECT coalesce(v->>'fileId', substring(v->>'url' from '^/__platform/files/([A-Za-z0-9_-]{1,128})/')) AS fid
    FROM jsonb_each(CASE WHEN jsonb_typeof(g.answers) = 'object' THEN g.answers ELSE '{}'::jsonb END) e(k, v)
    WHERE jsonb_typeof(v) = 'object'
      AND (SELECT count(*) FROM jsonb_object_keys(v)) = 1
      AND (jsonb_typeof(v->'fileId') = 'string' OR jsonb_typeof(v->'url') = 'string')
  ) x
  WHERE x.fid ~ '^[A-Za-z0-9_-]{1,128}$'
  ON CONFLICT (file_id) DO NOTHING;
  RETURN NULL;
END
$$;

CREATE OR REPLACE FUNCTION "responses_rollups_update"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM intelform_contacts_refresh(ARRAY(
    SELECT contact_key FROM old_rows WHERE contact_key IS NOT NULL
    UNION SELECT contact_key FROM new_rows WHERE contact_key IS NOT NULL
  ));
  RETURN NULL;
END
$$;

DROP TRIGGER IF EXISTS "responses_rollups_insert" ON "responses";
CREATE TRIGGER "responses_rollups_insert" AFTER INSERT ON "responses"
  REFERENCING NEW TABLE AS ins FOR EACH STATEMENT EXECUTE FUNCTION "responses_rollups_insert"();
DROP TRIGGER IF EXISTS "responses_rollups_delete" ON "responses";
CREATE TRIGGER "responses_rollups_delete" AFTER DELETE ON "responses"
  REFERENCING OLD TABLE AS gone FOR EACH STATEMENT EXECUTE FUNCTION "responses_rollups_delete"();
DROP TRIGGER IF EXISTS "responses_rollups_update" ON "responses";
CREATE TRIGGER "responses_rollups_update" AFTER UPDATE ON "responses"
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION "responses_rollups_update"();

-- ---------------------------------------------------------------------------
-- Exports built by the intelform-exports job (a big CSV or ZIP never runs in a request): the
-- file is kept in parts until it is downloaded, and swept a day later.
-- ---------------------------------------------------------------------------
CREATE TABLE "intelform_exports" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" INTEGER NOT NULL,
    "kind" VARCHAR(16) NOT NULL,
    "form_id" UUID,
    "params" JSONB NOT NULL DEFAULT '{}',
    "status" VARCHAR(10) NOT NULL DEFAULT 'running',
    "state" JSONB NOT NULL DEFAULT '{}',
    "rows" INTEGER NOT NULL DEFAULT 0,
    "bytes" BIGINT NOT NULL DEFAULT 0,
    "parts" INTEGER NOT NULL DEFAULT 0,
    "file_name" VARCHAR(200) NOT NULL,
    "content_type" VARCHAR(60) NOT NULL,
    "error" VARCHAR(300),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "intelform_exports_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "intelform_exports_user_id_created_at_idx" ON "intelform_exports"("user_id", "created_at" DESC);
CREATE INDEX "intelform_exports_created_at_idx" ON "intelform_exports"("created_at");
CREATE INDEX "intelform_exports_form_id_idx" ON "intelform_exports"("form_id");
ALTER TABLE "intelform_exports" ADD CONSTRAINT "intelform_exports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "intelform_exports" ADD CONSTRAINT "intelform_exports_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "intelform_exports" ADD CONSTRAINT "intelform_exports_kind_check" CHECK ("kind" IN ('responses', 'all', 'contacts'));
ALTER TABLE "intelform_exports" ADD CONSTRAINT "intelform_exports_status_check" CHECK ("status" IN ('running', 'ready', 'failed'));

CREATE TABLE "intelform_export_parts" (
    "export_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,

    CONSTRAINT "intelform_export_parts_pkey" PRIMARY KEY ("export_id","seq")
);
ALTER TABLE "intelform_export_parts" ADD CONSTRAINT "intelform_export_parts_export_id_fkey" FOREIGN KEY ("export_id") REFERENCES "intelform_exports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
