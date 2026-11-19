-- Response caps without a transaction: a capped submit is ONE autocommit statement whose target
-- row is the form's small form_caps row (submit.ts cappedInsertSql). Its UPDATE waits on that
-- row and, in READ COMMITTED, re-checks `taken < cap` on the newest version (EvalPlanQual), so
-- parallel submits fill a cap of N with exactly N responses.
--
--  * form_caps.taken is the form's exact response count, kept by two small statement triggers on
--    responses (below): +n per insert statement, -n per delete statement. A retried fill that
--    the unique (form_id, submission_id) index refuses inserts nothing, so it takes no slot; a
--    deleted response frees one. The existing rollup triggers are not changed.
--  * cap is the cap the last capped submit saw in forms.settings (the submit writes it; the
--    owner's settings stay the source of truth).
--  * A row exists only while a form has a cap: the first capped submit creates it from the
--    exact count (form_counts), and an uncapped submit removes a leftover one, so a burst on an
--    uncapped form never queues on it.
BEGIN;

CREATE TABLE "form_caps" (
    "form_id" UUID NOT NULL,
    "cap" INTEGER NOT NULL,
    "taken" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "form_caps_pkey" PRIMARY KEY ("form_id")
);
ALTER TABLE "form_caps" ADD CONSTRAINT "form_caps_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "form_caps_count_insert"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE form_caps fc SET taken = fc.taken + i.n
  FROM (SELECT form_id, count(*)::int AS n FROM ins GROUP BY 1) i
  WHERE fc.form_id = i.form_id;
  RETURN NULL;
END
$$;

CREATE OR REPLACE FUNCTION "form_caps_count_delete"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE form_caps fc SET taken = greatest(fc.taken - g.n, 0)
  FROM (SELECT form_id, count(*)::int AS n FROM gone GROUP BY 1) g
  WHERE fc.form_id = g.form_id;
  RETURN NULL;
END
$$;

-- CREATE TRIGGER locks responses against writes until COMMIT, so the backfill below counts every
-- response, and every later one goes through the triggers.
DROP TRIGGER IF EXISTS "responses_form_caps_insert" ON "responses";
CREATE TRIGGER "responses_form_caps_insert" AFTER INSERT ON "responses"
  REFERENCING NEW TABLE AS ins FOR EACH STATEMENT EXECUTE FUNCTION "form_caps_count_insert"();
DROP TRIGGER IF EXISTS "responses_form_caps_delete" ON "responses";
CREATE TRIGGER "responses_form_caps_delete" AFTER DELETE ON "responses"
  REFERENCING OLD TABLE AS gone FOR EACH STATEMENT EXECUTE FUNCTION "form_caps_count_delete"();

-- Forms that have a cap today, at their exact count.
INSERT INTO "form_caps" ("form_id", "cap", "taken")
SELECT f.id,
  least(ceil((f.settings->>'responseCap')::numeric), 2147483647)::int,
  greatest(coalesce((SELECT sum(fc.responses) FROM form_counts fc WHERE fc.form_id = f.id), 0), 0)::int
FROM forms f
WHERE jsonb_typeof(f.settings->'responseCap') = 'number'
ON CONFLICT ("form_id") DO NOTHING;

COMMIT;
