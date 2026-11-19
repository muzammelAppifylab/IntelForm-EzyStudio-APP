-- Summary rollups: Responses → Summary on a form with a million responses and hundreds of
-- questions reads a few thousand pre-added rows instead of walking every answer.
--
--  * form_summary_state: one row per form: the app time zone the days are in, a generation
--    (a new one when the zone changes; old rows are removed a batch at a time), the watermark
--    (submitted_at, id) up to which responses are added up, the event-bucket watermark, and the
--    field classes the sums were made with (which fields are counted per option, summed as
--    numbers, or kept by exact value).
--  * form_summary_days: the sums, per day ('d' / 'D') and per month ('m' / 'M', day = the 1st).
--    Lowercase grains hold per-question rows, uppercase the form-level ones (field_id ''), so the
--    daily series reads a few rows a day. Kinds:
--      r responses · u durations under a day (n, s = sum ms) · d duration histogram (key = bucket)
--      e funnel events (key v = views, s = starts) · a answered · c per option (key = option id)
--      v numbers (n, s = sum) · h number values (key = value, 6 significant digits)
--      t time per question histogram (key = bucket)
--    Filled OFF the submit path by refreshSummaryRollups (src/server/intelform/summary), called
--    from the every-minute job; kept right on delete by the statement trigger below.
--  * form_summary_contrib(): what a set of responses adds, ONE definition used by the refresh,
--    the Summary read (responses not added up yet) and the delete / update trigger.
BEGIN;

CREATE TABLE "form_summary_state" (
    "form_id" UUID NOT NULL,
    "tz" VARCHAR(64) NOT NULL,
    "gen" INTEGER NOT NULL DEFAULT 1,
    "wm_at" TIMESTAMPTZ(3),
    "wm_id" UUID,
    "ev_wm" TIMESTAMPTZ(3),
    "fields" JSONB NOT NULL DEFAULT '{}',
    "fields_version" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "form_summary_state_pkey" PRIMARY KEY ("form_id")
);
ALTER TABLE "form_summary_state" ADD CONSTRAINT "form_summary_state_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "form_summary_days" (
    "form_id" UUID NOT NULL,
    "gen" INTEGER NOT NULL,
    "grain" CHAR(1) NOT NULL,
    "day" DATE NOT NULL,
    "field_id" VARCHAR(64) NOT NULL,
    "kind" CHAR(1) NOT NULL,
    "key" VARCHAR(64) NOT NULL,
    "n" INTEGER NOT NULL,
    "s" NUMERIC,

    CONSTRAINT "form_summary_days_pkey" PRIMARY KEY ("form_id", "gen", "grain", "day", "field_id", "kind", "key")
);
ALTER TABLE "form_summary_days" ADD CONSTRAINT "form_summary_days_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Log buckets for milliseconds: '-1' under 1 ms, else floor(ln(v) / ln(r)). The reader turns a
-- bucket back into r^(b + 0.5), so a median is within about r/2 of the exact one.
CREATE OR REPLACE FUNCTION "form_summary_bucket"(v NUMERIC, r DOUBLE PRECISION) RETURNS TEXT
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN v IS NULL THEN NULL WHEN v < 1 THEN '-1'
    ELSE floor(ln(least(v, 1e300)::float8) / ln(r))::int::text END
$$;

-- A number answer kept by value, rounded to 6 significant digits (short text, any magnitude).
CREATE OR REPLACE FUNCTION "form_summary_num_key"(v NUMERIC) RETURNS TEXT
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN v IS NULL THEN NULL
    WHEN abs(v) < 1e-300 THEN '0'
    WHEN abs(v) >= 1e300 THEN (sign(v) * 1e300)::float8::text
    ELSE round(v, 5 - floor(log(abs(v)))::int)::float8::text END
$$;

-- What responses add to the sums, by local day. Arrays in step (one element per response);
-- p_counted / p_numeric / p_exact are the field classes (see form_summary_state.fields).
CREATE OR REPLACE FUNCTION "form_summary_contrib"(
  p_days DATE[], p_answers JSONB[], p_ttc JSONB[], p_dur INTEGER[],
  p_counted TEXT[], p_numeric TEXT[], p_exact TEXT[]
) RETURNS TABLE ("day" DATE, "field_id" TEXT, "kind" TEXT, "key" TEXT, "n" BIGINT, "s" NUMERIC)
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  WITH r AS MATERIALIZED (
    SELECT * FROM unnest(p_days, p_answers, p_ttc, p_dur) AS r(day, answers, ttc, dur)
  ),
  a AS MATERIALIZED (
    SELECT r.day, left(e.key, 64) AS field_id, e.value
    FROM r CROSS JOIN LATERAL jsonb_each(CASE WHEN jsonb_typeof(r.answers) = 'object' THEN r.answers ELSE '{}'::jsonb END) e
  ),
  items AS (
    SELECT r.day, ''::text AS field_id, 'r'::text AS kind, ''::text AS key, NULL::numeric AS s FROM r
    UNION ALL
    SELECT r.day, '', 'u', '', r.dur::numeric FROM r WHERE r.dur < 86400000
    UNION ALL
    SELECT r.day, '', 'd', form_summary_bucket(r.dur, 1.1), NULL FROM r WHERE r.dur IS NOT NULL
    UNION ALL
    SELECT a.day, a.field_id, 'a', '', NULL FROM a
    UNION ALL
    SELECT a.day, a.field_id, 'c', left(c.value->>'option', 64), NULL
    FROM a JOIN unnest(p_counted) f(id) ON f.id = a.field_id
    CROSS JOIN LATERAL jsonb_array_elements(CASE jsonb_typeof(a.value)
      WHEN 'array' THEN a.value WHEN 'object' THEN jsonb_build_array(a.value)
      ELSE jsonb_build_array(jsonb_build_object('option', a.value)) END) c
    WHERE c.value->>'option' IS NOT NULL
    UNION ALL
    SELECT a.day, a.field_id, 'v', '', a.value::numeric
    FROM a JOIN unnest(p_numeric) f(id) ON f.id = a.field_id WHERE jsonb_typeof(a.value) = 'number'
    UNION ALL
    SELECT a.day, a.field_id, 'h', form_summary_num_key(a.value::numeric), NULL
    FROM a JOIN unnest(p_exact) f(id) ON f.id = a.field_id WHERE jsonb_typeof(a.value) = 'number'
    UNION ALL
    SELECT r.day, left(t.key, 64), 't', form_summary_bucket(t.value::numeric, 1.2), NULL
    FROM r CROSS JOIN LATERAL jsonb_each(CASE WHEN jsonb_typeof(r.ttc) = 'object' THEN r.ttc ELSE '{}'::jsonb END) t
    WHERE jsonb_typeof(t.value) = 'number'
  )
  SELECT i.day, i.field_id, i.kind, i.key, count(*), sum(i.s) FROM items i GROUP BY 1, 2, 3, 4
$$;

-- Adds (p_sign 1) or takes away (-1) responses' contributions, per day and per month, in key
-- order (two writers touching the same rows lock them in the same order). Rows left at n = 0 on
-- the touched days are removed.
CREATE OR REPLACE FUNCTION "form_summary_apply"(
  p_form UUID, p_gen INTEGER, p_sign INTEGER,
  p_days DATE[], p_answers JSONB[], p_ttc JSONB[], p_dur INTEGER[], p_fields JSONB
) RETURNS INTEGER
LANGUAGE plpgsql AS $$
DECLARE
  touched INTEGER;
BEGIN
  INSERT INTO form_summary_days AS d (form_id, gen, grain, day, field_id, kind, key, n, s)
  SELECT p_form, p_gen, g.grain,
    CASE WHEN g.grain IN ('m', 'M') THEN date_trunc('month', c.day)::date ELSE c.day END,
    c.field_id, c.kind, c.key, (p_sign * sum(c.n))::int, p_sign * sum(c.s)
  FROM form_summary_contrib(p_days, p_answers, p_ttc, p_dur,
      ARRAY(SELECT jsonb_array_elements_text(coalesce(p_fields->'counted', '[]'))),
      ARRAY(SELECT jsonb_array_elements_text(coalesce(p_fields->'numeric', '[]'))),
      ARRAY(SELECT jsonb_array_elements_text(coalesce(p_fields->'exact', '[]')))) c
  CROSS JOIN LATERAL (VALUES
      (CASE WHEN c.field_id = '' THEN 'D' ELSE 'd' END),
      (CASE WHEN c.field_id = '' THEN 'M' ELSE 'm' END)) g(grain)
  GROUP BY 3, 4, 5, 6, 7
  ORDER BY 3, 4, 5, 6, 7
  ON CONFLICT (form_id, gen, grain, day, field_id, kind, key) DO UPDATE SET
    n = d.n + EXCLUDED.n,
    s = CASE WHEN EXCLUDED.s IS NULL THEN d.s ELSE coalesce(d.s, 0) + EXCLUDED.s END;
  GET DIAGNOSTICS touched = ROW_COUNT;
  IF p_sign < 0 THEN
    DELETE FROM form_summary_days d
    USING (SELECT DISTINCT g.grain, CASE WHEN g.grain IN ('m', 'M') THEN date_trunc('month', x.day)::date ELSE x.day END AS day
           FROM unnest(p_days) x(day), unnest(ARRAY['d', 'D', 'm', 'M']) g(grain)) t
    WHERE d.form_id = p_form AND d.gen = p_gen AND d.grain = t.grain AND d.day = t.day AND d.n = 0;
  END IF;
  RETURN touched;
END
$$;

-- Deleted responses that were already added up are taken away again, in the same statement as
-- the delete: a single delete, a selection, a contact erase, retention. A form being deleted is
-- skipped (its sums go with it). Responses past the watermark were never added. The refresh
-- locks the rows it reads (FOR SHARE), so a delete racing it either waits for it (and then sees
-- the new watermark) or goes first (and the refresh never sees the row).
CREATE OR REPLACE FUNCTION "form_summary_on_delete"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  x record;
BEGIN
  FOR x IN
    SELECT s.form_id, s.gen, s.fields,
      array_agg((g.submitted_at AT TIME ZONE s.tz)::date) AS days, array_agg(g.answers) AS answers,
      array_agg(g.ttc) AS ttc, array_agg(g.duration_ms) AS dur
    FROM form_summary_gone g JOIN form_summary_state s ON s.form_id = g.form_id
    WHERE s.wm_at IS NOT NULL AND (g.submitted_at < s.wm_at OR (g.submitted_at = s.wm_at AND g.id <= s.wm_id))
      AND EXISTS (SELECT 1 FROM forms f WHERE f.id = g.form_id)
    GROUP BY s.form_id
  LOOP
    PERFORM form_summary_apply(x.form_id, x.gen, -1, x.days, x.answers, x.ttc, x.dur, x.fields);
  END LOOP;
  RETURN NULL;
END
$$;

DROP TRIGGER IF EXISTS "form_summary_delete" ON "responses";
CREATE TRIGGER "form_summary_delete" AFTER DELETE ON "responses"
  REFERENCING OLD TABLE AS form_summary_gone FOR EACH STATEMENT EXECUTE FUNCTION "form_summary_on_delete"();

-- Nothing changes these columns today. If anything ever does, the sums follow: the old values
-- are taken away and the new ones added (each only when inside the watermark). Row level with a
-- column list, so updates of other columns (contacts) never run it.
CREATE OR REPLACE FUNCTION "form_summary_on_update"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  s record;
BEGIN
  IF (OLD.answers, OLD.ttc, OLD.duration_ms, OLD.submitted_at, OLD.form_id)
     IS NOT DISTINCT FROM (NEW.answers, NEW.ttc, NEW.duration_ms, NEW.submitted_at, NEW.form_id) THEN
    RETURN NULL;
  END IF;
  SELECT * INTO s FROM form_summary_state WHERE form_id = OLD.form_id;
  IF FOUND AND s.wm_at IS NOT NULL AND (OLD.submitted_at < s.wm_at OR (OLD.submitted_at = s.wm_at AND OLD.id <= s.wm_id)) THEN
    PERFORM form_summary_apply(s.form_id, s.gen, -1, ARRAY[(OLD.submitted_at AT TIME ZONE s.tz)::date],
      ARRAY[OLD.answers], ARRAY[OLD.ttc], ARRAY[OLD.duration_ms], s.fields);
  END IF;
  SELECT * INTO s FROM form_summary_state WHERE form_id = NEW.form_id;
  IF FOUND AND s.wm_at IS NOT NULL AND (NEW.submitted_at < s.wm_at OR (NEW.submitted_at = s.wm_at AND NEW.id <= s.wm_id)) THEN
    PERFORM form_summary_apply(s.form_id, s.gen, 1, ARRAY[(NEW.submitted_at AT TIME ZONE s.tz)::date],
      ARRAY[NEW.answers], ARRAY[NEW.ttc], ARRAY[NEW.duration_ms], s.fields);
  END IF;
  RETURN NULL;
END
$$;

DROP TRIGGER IF EXISTS "form_summary_update" ON "responses";
CREATE TRIGGER "form_summary_update" AFTER UPDATE OF "answers", "ttc", "duration_ms", "submitted_at", "form_id" ON "responses"
  FOR EACH ROW EXECUTE FUNCTION "form_summary_on_update"();

COMMIT;
