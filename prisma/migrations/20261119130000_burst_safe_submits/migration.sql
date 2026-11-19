-- Burst-safe submits (10k responses a minute on one form):
--  * form_counts: a form's all-time response and start counts in 16 shards, kept by the
--    responses triggers (responses) and the events route (starts). Submits no longer update the
--    forms row (only a form with a response cap takes its lock). forms.response_count,
--    starts_total and last_response_at stay as a copy, refreshed every minute.
--  * form_response_hours and form_event_counts get a shard too: one hot row per form per hour /
--    15 minutes becomes 16.
--  * intelform_notify_queue: responses still to notify, drained by one job a minute instead of
--    one job per response (the platform takes 10 new jobs a minute by default).
--  * responses.submission_id: a retried submit is saved once.
BEGIN;

ALTER TABLE "responses" ADD COLUMN "submission_id" VARCHAR(64);
-- Its unique index is built CONCURRENTLY in the next migration (no lock on submits).

ALTER TABLE "form_event_counts" DROP CONSTRAINT "form_event_counts_pkey",
ADD COLUMN "shard" SMALLINT NOT NULL DEFAULT 0,
ADD CONSTRAINT "form_event_counts_pkey" PRIMARY KEY ("form_id", "bucket", "shard");

ALTER TABLE "form_response_hours" DROP CONSTRAINT "form_response_hours_pkey",
ADD COLUMN "shard" SMALLINT NOT NULL DEFAULT 0,
ADD CONSTRAINT "form_response_hours_pkey" PRIMARY KEY ("form_id", "hour", "shard");

CREATE TABLE "form_counts" (
    "form_id" UUID NOT NULL,
    "shard" SMALLINT NOT NULL,
    "responses" INTEGER NOT NULL DEFAULT 0,
    "starts" INTEGER NOT NULL DEFAULT 0,
    "last_response_at" TIMESTAMPTZ(3),

    CONSTRAINT "form_counts_pkey" PRIMARY KEY ("form_id","shard")
);
ALTER TABLE "form_counts" ADD CONSTRAINT "form_counts_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Today's totals go into shard 0.
INSERT INTO "form_counts" ("form_id", "shard", "responses", "starts", "last_response_at")
SELECT "id", 0, "response_count", "starts_total", "last_response_at" FROM "forms";

CREATE TABLE "intelform_notify_queue" (
    "response_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimed_at" TIMESTAMPTZ(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "intelform_notify_queue_pkey" PRIMARY KEY ("response_id")
);
CREATE INDEX "intelform_notify_queue_created_at_idx" ON "intelform_notify_queue"("created_at");
ALTER TABLE "intelform_notify_queue" ADD CONSTRAINT "intelform_notify_queue_response_id_fkey" FOREIGN KEY ("response_id") REFERENCES "responses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The rollup triggers: one random shard per statement for new responses; deletes subtract from
-- shard 0 (shards may go negative, the sum is exact).
CREATE OR REPLACE FUNCTION "responses_rollups_insert"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  s smallint := floor(random() * 16)::smallint;
BEGIN
  INSERT INTO form_counts AS fc (form_id, shard, responses, last_response_at)
  SELECT form_id, s, count(*)::int, max(submitted_at) FROM ins GROUP BY 1
  ON CONFLICT (form_id, shard) DO UPDATE SET
    responses = fc.responses + EXCLUDED.responses,
    last_response_at = greatest(fc.last_response_at, EXCLUDED.last_response_at);

  INSERT INTO form_response_hours AS h (form_id, hour, shard, n)
  SELECT form_id, date_trunc('hour', submitted_at), s, count(*)::int FROM ins GROUP BY 1, 2
  ON CONFLICT (form_id, hour, shard) DO UPDATE SET n = h.n + EXCLUDED.n;

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
  INSERT INTO form_counts AS fc (form_id, shard, responses)
  SELECT g.form_id, 0, -count(*)::int FROM gone g
  WHERE EXISTS (SELECT 1 FROM forms f WHERE f.id = g.form_id)
  GROUP BY 1
  ON CONFLICT (form_id, shard) DO UPDATE SET responses = fc.responses + EXCLUDED.responses;

  INSERT INTO form_response_hours AS h (form_id, hour, shard, n)
  SELECT g.form_id, date_trunc('hour', g.submitted_at), 0, -count(*)::int FROM gone g
  WHERE EXISTS (SELECT 1 FROM forms f WHERE f.id = g.form_id)
  GROUP BY 1, 2
  ON CONFLICT (form_id, hour, shard) DO UPDATE SET n = h.n + EXCLUDED.n;

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

COMMIT;
