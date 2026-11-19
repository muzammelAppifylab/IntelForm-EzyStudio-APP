-- Contacts at scale (500k contacts, 1M responses on a form, 10k submits a minute):
--  * responses_rollups_insert takes the contacts rows FIRST (in key order), then the form's
--    form_counts and form_response_hours shards. Many submits from one email or phone wait on
--    that one contacts row while holding no shard lock, so they never block the form's other
--    respondents.
--  * contacts.form_ids is kept most recently answered first: the list shows its first 3 titles
--    and the CSV all of them, without reading responses.
--  * A delete is taken off the contacts it touched incrementally (responses_contacts_delete,
--    from the deleted rows): no re-aggregate of every response of every key. First / last seen,
--    the forms and the latest details are looked up again only when a deleted row was the one
--    they came from, by index, one form at a time (responses_contact_form index).
--  * intelform_contacts_refresh (still called by responses_rollups_delete and
--    responses_rollups_update) skips the keys the delete trigger just did; otherwise it rebuilds
--    them (an update of a response's answers, which no code does today).
BEGIN;

-- Distinct values of an array, first occurrence first.
CREATE OR REPLACE FUNCTION "intelform_uniq_uuids"(xs uuid[]) RETURNS uuid[]
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT coalesce(array_agg(z.x ORDER BY z.o), '{}'::uuid[])
  FROM (SELECT u.x, min(u.o) AS o FROM unnest(xs) WITH ORDINALITY AS u(x, o) GROUP BY u.x) z
$$;

CREATE OR REPLACE FUNCTION "responses_rollups_insert"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  s smallint := floor(random() * 16)::smallint;
BEGIN
  -- Contacts first (lock order: contacts rows in key order, then the form's shards).
  INSERT INTO contacts AS c (key, n, first_seen, last_seen, email, name, phone, country, form_ids, form_count)
  SELECT g.key, g.n, g.first_seen, g.last_seen, g.email, g.name, g.phone, g.country, g.form_ids, cardinality(g.form_ids)
  FROM (
    SELECT contact_key AS key, count(*)::int AS n, min(submitted_at) AS first_seen, max(submitted_at) AS last_seen,
      (array_agg(contact_email ORDER BY submitted_at DESC, id DESC) FILTER (WHERE contact_email IS NOT NULL))[1] AS email,
      (array_agg(contact_name ORDER BY submitted_at DESC, id DESC) FILTER (WHERE contact_name IS NOT NULL))[1] AS name,
      (array_agg(contact_phone ORDER BY submitted_at DESC, id DESC) FILTER (WHERE contact_phone IS NOT NULL))[1] AS phone,
      (array_agg(country ORDER BY submitted_at DESC, id DESC) FILTER (WHERE country IS NOT NULL))[1] AS country,
      intelform_uniq_uuids(array_agg(form_id ORDER BY submitted_at DESC, id DESC)) AS form_ids
    FROM ins WHERE contact_key IS NOT NULL
    GROUP BY contact_key
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
    -- Most recently answered first; the usual case (the same form again) keeps the array as it is.
    form_ids = CASE
      WHEN c.form_ids[1:cardinality(EXCLUDED.form_ids)] = EXCLUDED.form_ids THEN c.form_ids
      WHEN EXCLUDED.last_seen >= c.last_seen THEN intelform_uniq_uuids(EXCLUDED.form_ids || c.form_ids)
      ELSE intelform_uniq_uuids(c.form_ids || EXCLUDED.form_ids) END,
    form_count = cardinality(CASE
      WHEN c.form_ids[1:cardinality(EXCLUDED.form_ids)] = EXCLUDED.form_ids THEN c.form_ids
      ELSE intelform_uniq_uuids(c.form_ids || EXCLUDED.form_ids) END);

  INSERT INTO form_counts AS fc (form_id, shard, responses, last_response_at)
  SELECT form_id, s, count(*)::int, max(submitted_at) FROM ins GROUP BY 1
  ON CONFLICT (form_id, shard) DO UPDATE SET
    responses = fc.responses + EXCLUDED.responses,
    last_response_at = greatest(fc.last_response_at, EXCLUDED.last_response_at);

  INSERT INTO form_response_hours AS h (form_id, hour, shard, n)
  SELECT form_id, date_trunc('hour', submitted_at), s, count(*)::int FROM ins GROUP BY 1, 2
  ON CONFLICT (form_id, hour, shard) DO UPDATE SET n = h.n + EXCLUDED.n;
  RETURN NULL;
END
$$;

-- Recomputes some contacts from all their responses (the slow, exact way); a key with no
-- response left goes. Only for what can't be done incrementally (see intelform_contacts_refresh).
CREATE OR REPLACE FUNCTION "intelform_contacts_rebuild"(keys text[]) RETURNS void
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

-- The marker the delete trigger leaves for the keys it just took care of: their sorted, distinct
-- list (array text quotes each key, so two lists never read the same).
CREATE OR REPLACE FUNCTION "intelform_contacts_mark"(keys text[]) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT md5(ARRAY(SELECT DISTINCT k FROM unnest(keys) AS k WHERE k IS NOT NULL ORDER BY k)::text)
$$;

-- Called by responses_rollups_delete (after responses_contacts_delete did the same keys
-- incrementally: skipped) and responses_rollups_update (rebuilt).
CREATE OR REPLACE FUNCTION "intelform_contacts_refresh"(keys text[]) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF keys IS NULL OR cardinality(keys) = 0 THEN
    RETURN;
  END IF;
  IF current_setting('intelform.contacts_done', true) = intelform_contacts_mark(keys) THEN
    PERFORM set_config('intelform.contacts_done', '', true);
    RETURN;
  END IF;
  PERFORM intelform_contacts_rebuild(keys);
END
$$;

-- Deleted responses, taken off their contacts: n minus what went; the forms that lost their
-- last response of that contact leave form_ids (order kept); first / last seen and each detail
-- are looked up again only when a deleted row may have been where they came from, by the
-- (contact_key, form_id, submitted_at DESC) index, one probe per remaining form.
CREATE OR REPLACE FUNCTION "responses_contacts_delete"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  keys text[];
  done text[];
  rest text[];
BEGIN
  SELECT coalesce(array_agg(DISTINCT contact_key ORDER BY contact_key), '{}') INTO keys
  FROM gone_contacts WHERE contact_key IS NOT NULL;
  IF cardinality(keys) = 0 THEN
    RETURN NULL;
  END IF;
  PERFORM set_config('intelform.contacts_done', intelform_contacts_mark(keys), true);

  -- Lock the rows in key order (the insert trigger takes them in the same order).
  PERFORM 1 FROM contacts WHERE key = ANY(keys) ORDER BY key FOR UPDATE;

  WITH d AS (
    SELECT g.contact_key AS key, count(*)::int AS n, min(g.submitted_at) AS first_at, max(g.submitted_at) AS last_at,
      array_agg(DISTINCT g.form_id) AS forms,
      array_agg(DISTINCT g.contact_email) FILTER (WHERE g.contact_email IS NOT NULL) AS emails,
      array_agg(DISTINCT g.contact_name) FILTER (WHERE g.contact_name IS NOT NULL) AS names,
      array_agg(DISTINCT g.contact_phone) FILTER (WHERE g.contact_phone IS NOT NULL) AS phones,
      array_agg(DISTINCT g.country) FILTER (WHERE g.country IS NOT NULL) AS countries
    FROM gone_contacts g WHERE g.contact_key IS NOT NULL
    GROUP BY g.contact_key
  ),
  f AS MATERIALIZED (
    SELECT c.key, c.n - d.n AS n, c.first_seen, c.last_seen, c.email, c.name, c.phone, c.country,
      d.first_at, d.last_at, d.emails, d.names, d.phones, d.countries,
      ARRAY(
        SELECT u.x FROM unnest(c.form_ids) WITH ORDINALITY AS u(x, o)
        -- A scalar probe, not EXISTS: EXISTS may become a hashed subplan reading every row of the key.
        WHERE u.x <> ALL (d.forms)
          OR (SELECT true FROM responses r WHERE r.contact_key = c.key AND r.form_id = u.x LIMIT 1)
        ORDER BY u.o
      ) AS form_ids
    FROM contacts c JOIN d ON d.key = c.key
    WHERE c.key = ANY (keys)
  ),
  v AS (
    SELECT f.key, f.n, f.form_ids,
      CASE WHEN f.first_at > f.first_seen THEN f.first_seen ELSE (
        SELECT min(t.at) FROM unnest(f.form_ids) AS fid, LATERAL (
          SELECT r.submitted_at AS at FROM responses r
          WHERE r.contact_key = f.key AND r.form_id = fid ORDER BY r.submitted_at ASC LIMIT 1
        ) t
      ) END AS first_seen,
      CASE WHEN f.last_at < f.last_seen THEN f.last_seen ELSE (
        SELECT max(t.at) FROM unnest(f.form_ids) AS fid, LATERAL (
          SELECT r.submitted_at AS at FROM responses r
          WHERE r.contact_key = f.key AND r.form_id = fid ORDER BY r.submitted_at DESC LIMIT 1
        ) t
      ) END AS last_seen,
      CASE WHEN f.email IS NULL OR f.emails IS NULL OR f.email <> ALL (f.emails) THEN f.email ELSE (
        SELECT t.v FROM unnest(f.form_ids) AS fid, LATERAL (
          SELECT r.contact_email AS v, r.submitted_at AS at, r.id FROM responses r
          WHERE r.contact_key = f.key AND r.form_id = fid AND r.contact_email IS NOT NULL
          ORDER BY r.submitted_at DESC, r.id DESC LIMIT 1
        ) t ORDER BY t.at DESC, t.id DESC LIMIT 1
      ) END AS email,
      CASE WHEN f.name IS NULL OR f.names IS NULL OR f.name <> ALL (f.names) THEN f.name ELSE (
        SELECT t.v FROM unnest(f.form_ids) AS fid, LATERAL (
          SELECT r.contact_name AS v, r.submitted_at AS at, r.id FROM responses r
          WHERE r.contact_key = f.key AND r.form_id = fid AND r.contact_name IS NOT NULL
          ORDER BY r.submitted_at DESC, r.id DESC LIMIT 1
        ) t ORDER BY t.at DESC, t.id DESC LIMIT 1
      ) END AS name,
      CASE WHEN f.phone IS NULL OR f.phones IS NULL OR f.phone <> ALL (f.phones) THEN f.phone ELSE (
        SELECT t.v FROM unnest(f.form_ids) AS fid, LATERAL (
          SELECT r.contact_phone AS v, r.submitted_at AS at, r.id FROM responses r
          WHERE r.contact_key = f.key AND r.form_id = fid AND r.contact_phone IS NOT NULL
          ORDER BY r.submitted_at DESC, r.id DESC LIMIT 1
        ) t ORDER BY t.at DESC, t.id DESC LIMIT 1
      ) END AS phone,
      CASE WHEN f.country IS NULL OR f.countries IS NULL OR f.country <> ALL (f.countries) THEN f.country ELSE (
        SELECT t.v FROM unnest(f.form_ids) AS fid, LATERAL (
          SELECT r.country AS v, r.submitted_at AS at, r.id FROM responses r
          WHERE r.contact_key = f.key AND r.form_id = fid AND r.country IS NOT NULL
          ORDER BY r.submitted_at DESC, r.id DESC LIMIT 1
        ) t ORDER BY t.at DESC, t.id DESC LIMIT 1
      ) END AS country
    FROM f
    WHERE f.n > 0 AND cardinality(f.form_ids) > 0
  ),
  u AS (
    UPDATE contacts c SET
      n = v.n, first_seen = v.first_seen, last_seen = v.last_seen,
      email = v.email, name = v.name, phone = v.phone, country = v.country,
      form_ids = v.form_ids, form_count = cardinality(v.form_ids)
    FROM v
    WHERE c.key = v.key AND v.first_seen IS NOT NULL AND v.last_seen IS NOT NULL
    RETURNING c.key
  )
  SELECT coalesce(array_agg(u.key), '{}') INTO done FROM u;

  -- The rest: contacts with nothing left (they go), or out of step (rebuilt, exact).
  rest := ARRAY(SELECT k FROM unnest(keys) AS k WHERE k <> ALL (done) ORDER BY k);
  IF cardinality(rest) > 0 THEN
    PERFORM intelform_contacts_rebuild(rest);
  END IF;
  RETURN NULL;
END
$$;

DROP TRIGGER IF EXISTS "responses_contacts_delete" ON "responses";
-- AFTER statement triggers run in name order: this one before responses_rollups_delete, whose
-- intelform_contacts_refresh call then finds these keys marked done.
CREATE TRIGGER "responses_contacts_delete" AFTER DELETE ON "responses"
  REFERENCING OLD TABLE AS gone_contacts FOR EACH STATEMENT EXECUTE FUNCTION "responses_contacts_delete"();

COMMIT;
