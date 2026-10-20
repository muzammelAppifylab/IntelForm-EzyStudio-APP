# Research: responses and analytics data layer

**Benchmarked 2026-10-19.** Setup:

- Postgres 17.11 in Docker (8 vCPU, 4 GB), default config.
- 410k responses: one form with 10k, one with 100k, and 300 forms with 1k each. Each response has 14 fields, about 600 B of answers.
- 1.8M funnel events.
- Times are the warm median of 5 runs. A cold first run can reach about 1.5 s.

Feeds [PLAN.md](../PLAN.md), wave 2, agent G.

## Headline findings

1. **Turn JIT off for the app's connection.** Misestimated `jsonb_each` / LATERAL plans trigger JIT and add 340–570 ms to a 140–200 ms query. **Done:** `connection: { jit: 'off' }` in `server/db/client.ts`.
2. **Index the foreign keys.**
   - Deleting a 1k-response form took **83.6 s, 1.25 s with indexes** on `responses(form_version_id)` and `webhook_deliveries(response_id)`.
   - Bulk-deleting 200 responses: **17.1 s → 1.8 s**.
3. **jsonb alone meets the 2 s summary target easily.** All cards take about 100–130 ms at 10k responses and about 0.8 s at 100k.

## Answer storage

Keep `responses.answers` as `{ fieldId: value }`.

| Field type | Stored value |
|---|---|
| Single choice, dropdown | `{"option":"o_a1"}`, or `{"option":"o_other","other":"text"}` |
| Multiple choice, picture choice | `[{"option":…}, …]` |
| Yes / No | `true` / `false` |
| Rating, NPS, number | JSON number |
| Country | `"US"` |
| Email, URL, phone, text | string |
| Date / Time | `"YYYY-MM-DD"` / `"HH:mm"` |
| Name | `{"first","last"}` or a string |
| Address | `{street, line2, city, state, postal, country}` |
| Consent | `{"accepted":true,"at":"ISO","text":"…","version":3}` (stamped by the server) |
| Signature | `"https://…png"` |
| Section break / empty | omitted (never null) |

**No normalised `response_answers` table.**

- It is faster per query (0.6–11 ms vs 3–48 ms at 10k), but both are far under budget.
- It is 2.1× the size of `responses`, adds about 15 rows per response to write and delete, and makes date ranges slower (it needs a join).
- If you ever need more speed, cache the summary JSON per form instead, and invalidate it on submit.

**Type changes.** When a field changes type and the form already has responses, the builder assigns a **new field id**. Every summary query also guards with `jsonb_typeof`.

## Summary queries

Inputs: `$1` = form id, `$tz` = timezone, `$from` / `$to` = local dates. The date range filter is:

`submitted_at >= ($from::date::timestamp AT TIME ZONE $tz) AND submitted_at < (($to::date + 1)::timestamp AT TIME ZONE $tz)`

Run the queries in parallel on the pool.

```sql
-- Top cards (3 ms / 33 ms at 100k). Show a median as well as the average: abandoned tabs skew the average.
SELECT count(*) responses, avg(duration_ms) FILTER (WHERE duration_ms < 86400000) avg_ms,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms) median_ms
FROM responses r WHERE form_id = $1 AND <range>;

-- Responses per day, DST-safe (0.4 / 2 ms)
SELECT d::date AS day, coalesce(c.n, 0) AS n
FROM generate_series($from::date, $to::date, interval '1 day') d
LEFT JOIN (SELECT (submitted_at AT TIME ZONE $tz)::date AS day, count(*) n
           FROM responses r WHERE form_id = $1 AND <range> GROUP BY 1) c ON c.day = d::date
ORDER BY 1;

-- Every choice-like field in one scan (28–48 ms / 183–238 ms). Labels and "(deleted option)" are added in TypeScript.
SELECT f.id AS field_id, c->>'option' AS option_id, count(*) n
FROM responses r CROSS JOIN unnest($2::text[]) f(id)
CROSS JOIN LATERAL jsonb_array_elements(CASE jsonb_typeof(r.answers->f.id)
   WHEN 'array' THEN r.answers->f.id WHEN 'object' THEN jsonb_build_array(r.answers->f.id)
   ELSE jsonb_build_array(jsonb_build_object('option', r.answers->f.id)) END) c   -- yes/no, country, rating, nps
WHERE r.form_id = $1 AND <range> GROUP BY 1, 2;

-- Answered count per field: the denominator for % (15–27 / 100 ms)
SELECT k AS field_id, count(*) answered FROM responses r CROSS JOIN LATERAL jsonb_object_keys(r.answers) k
WHERE r.form_id = $1 AND <range> GROUP BY 1;

-- Numbers, rating, NPS (43 / 390 ms)
SELECT e.key field_id, count(*) n, avg(e.value::numeric), min(e.value::numeric), max(e.value::numeric),
  percentile_cont(0.5) WITHIN GROUP (ORDER BY e.value::numeric) median,
  round(100.0 * (count(*) FILTER (WHERE e.value::numeric >= 9) - count(*) FILTER (WHERE e.value::numeric <= 6)) / count(*)) nps,
  count(*) FILTER (WHERE e.value::numeric <= 6) detractors,
  count(*) FILTER (WHERE e.value::numeric BETWEEN 7 AND 8) passives,
  count(*) FILTER (WHERE e.value::numeric >= 9) promoters
FROM responses r CROSS JOIN LATERAL jsonb_each(r.answers) e
WHERE r.form_id = $1 AND <range> AND e.key = ANY($2) AND jsonb_typeof(e.value) = 'number' GROUP BY 1;

-- Latest 10 per text, date or time field (0.2 ms)
SELECT f.id field_id, t.* FROM unnest($2::text[]) f(id) CROSS JOIN LATERAL (
  SELECT id, submitted_at, answers->f.id val FROM responses
  WHERE form_id = $1 AND answers ? f.id ORDER BY submitted_at DESC, id DESC LIMIT 10) t;

-- "Other" answers (0.2 ms). For multiple choice, wrap the object in jsonb_build_array.
SELECT id, submitted_at, answers->$2->>'other' FROM responses
WHERE form_id = $1 AND answers @> jsonb_build_object($2::text, jsonb_build_object('option', 'o_other'))
ORDER BY submitted_at DESC LIMIT 10;

-- Signature and consent counts (3 ms)
SELECT count(*) FILTER (WHERE answers ? $2) signed,
       count(*) FILTER (WHERE (answers->$3->>'accepted')::boolean) accepted
FROM responses WHERE form_id = $1;
```

**Completion rate** = `least(responses / nullif(starts, 0), 1)`.

## Table view

- **Pagination:** offset for the UI (page numbers, sort by any column); keyset for the default sort, CSV cursors and drawer prev/next.

  | Query | 10k | 100k |
  |---|---|---|
  | Offset, page 1 | 0.6 ms | 1.3 ms |
  | Offset, last page | 7.5 ms | 327 ms |
  | Keyset, last page | 0.3 ms | 0.4 ms |
  | Sort by a jsonb text field, page 1 / last page | 4.6 / 25 ms | 325 / 656 ms |
  | Sort by a number field, page 1 | 6.6 ms | 87 ms |
  | `count(*)` total | 0.5 ms | 4 ms |
  | Count with a choice filter | 3 ms | 10 ms |

  Exact totals are affordable, so show them.
- **Sort expressions** come from the field registry, always followed by `, id DESC` as a tie-breaker:
  - numbers: `(answers->>$f)::numeric`;
  - choices: `array_position($idsSortedByLabel, answers->$f->>'option')`;
  - dates: ISO text order works.
- **Default sort index:** replace the current one with `(form_id, submitted_at DESC, id DESC)`. Without `id`, Postgres adds a sort step.
- **Search: pg_trgm on a server-built `search_text` column.**
  - At submit, the registry concatenates the text answers: name, email, phone, url, short and long text, address, and "Other" text.
  - It supports substring and ILIKE matches, which emails and partial names need.
  - Timings at 10k: page 0.7 ms, count 2.1 ms. At 100k: count 27 ms.
  - The alternatives are worse:
    - `tsvector` is similar in speed but can't match substrings;
    - `answers::text ILIKE` takes 57 / 284 ms and also matches keys and option ids.
- **Choice filters:** `answers @> '{"f_x":{"option":"o_2"}}'`, or `'{"f_x":[{"option":"o_2"}]}'` for multiple choice.
  - Keep the `jsonb_path_ops` GIN: it beats the btree at 100k (10 vs 45 ms).
  - It also serves the one-per-email check.
  - It doesn't slow writes measurably.

**Column preferences:**

```sql
CREATE TABLE response_table_prefs (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  form_id uuid NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  columns jsonb NOT NULL,  -- ordered [{"id":"submitted_at","visible":true},{"id":"f_8k2m","visible":false},…]
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, form_id));
```

When rendering, add any field missing from the saved list at its form position.

## Labels at submission time

- **Drawer:**

  ```sql
  SELECT r.*, v.version, v.definition FROM responses r JOIN form_versions v ON v.id = r.form_version_id
  WHERE r.id = $1 AND r.form_id = $2
  ```

  Render labels from that version's definition.
- **Table and summary field catalog:**

  ```sql
  SELECT DISTINCT ON (f->>'id') f->>'id' id, f->>'type' type, f->>'label' label, f->'props'->'options' options, v.version
  FROM form_versions v CROSS JOIN LATERAL jsonb_array_elements(v.definition->'fields') f
  WHERE v.form_id = $1 ORDER BY f->>'id', v.version DESC;
  ```

  - Fields in the published version are current, in form order.
  - Fields only in older versions are appended with their last label plus "(deleted)".
  - Removed options get "(deleted option)".
  - Current labels come from the published version; draft-only renames show after Publish.

## Funnel events

- **Dedupe.** The client makes one uuid per form in sessionStorage and sends view and start with `sendBeacon`. The server inserts with `ON CONFLICT DO NOTHING` (unique key exists) and applies the per-IP rate limit. Prefer a uuid `session_token`.
- **Volume.** A raw event is about 290 B, so 500 forms × 50k views is about 7 GB. Fix it with **a rollup plus retention**, not partitioning:

  ```sql
  WITH ins AS (INSERT INTO form_events (form_id, type, session_token) VALUES ($1, $2, $3)
               ON CONFLICT DO NOTHING RETURNING form_id, type, created_at)
  INSERT INTO form_event_counts (form_id, bucket, views, starts)
  SELECT form_id, date_bin('15 minutes', created_at, '2000-01-01'), (type = 'view')::int, (type = 'start')::int FROM ins
  ON CONFLICT (form_id, bucket) DO UPDATE SET views = form_event_counts.views + EXCLUDED.views,
                                             starts = form_event_counts.starts + EXCLUDED.starts;
  ```

  - 15-minute buckets give correct day boundaries in every timezone, including +5:30 and +5:45.
  - A daily job deletes raw events older than 30 days.
  - The funnel card reads the rollup.

## DDL (split by owner)

```sql
-- 0002_platform (C)
CREATE INDEX sessions_expires ON sessions (expires_at);
CREATE INDEX password_resets_user ON password_resets (user_id);
CREATE INDEX password_resets_expires ON password_resets (expires_at);
CREATE INDEX webhook_deliveries_response ON webhook_deliveries (response_id);

-- 0003_forms (D)
CREATE INDEX form_slugs_old_form ON form_slugs_old (form_id);
CREATE INDEX responses_form_version ON responses (form_version_id);
ALTER TABLE forms ADD COLUMN response_count integer NOT NULL DEFAULT 0, ADD COLUMN last_response_at timestamptz;
ALTER TABLE templates ADD COLUMN builtin_hash text;

-- 0004_responses (G)
DROP INDEX responses_form_submitted;
CREATE INDEX responses_form_submitted ON responses (form_id, submitted_at DESC, id DESC);
ALTER TABLE responses ADD CONSTRAINT responses_answers_object CHECK (jsonb_typeof(answers) = 'object');
ALTER TABLE responses ADD COLUMN search_text text NOT NULL DEFAULT '';
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX responses_search_trgm ON responses USING gin (search_text gin_trgm_ops);
CREATE INDEX responses_browser ON responses (form_id, browser_token) WHERE browser_token IS NOT NULL;
CREATE INDEX responses_submitted_brin ON responses USING brin (submitted_at);
CREATE TABLE form_event_counts (form_id uuid NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  bucket timestamptz NOT NULL, views integer NOT NULL DEFAULT 0, starts integer NOT NULL DEFAULT 0,
  PRIMARY KEY (form_id, bucket));
CREATE INDEX form_events_created_brin ON form_events USING brin (created_at);
-- plus response_table_prefs
```

**Response counts on the forms list.** `forms.response_count` replaces a cross-form group-by: 34 ms warm, but 3 s cold. The submit and delete transactions keep it up to date.

## Templates

- **Format.** `BUILTIN_TEMPLATES` use the same format as forms. Tests parse each one, publish it and submit a response.
- **Seeding** happens on server start, as an idempotent upsert keyed by slug that updates only when `builtin_hash` (sha256 of the canonical JSON) changes. It deletes built-ins that are no longer shipped.
- **Slugs.** Built-in slugs start with `builtin-`.
- **Copying.** Copying a template generates new field and option ids.

## Risks

- **JIT has to stay off.** Misestimated plans jump to about 0.6 s, and once hit 15 s.
- **Changing a field's type while keeping its id** mixes JSON types under one key.
- **One-per-email race.** Two simultaneous submits can both pass the check. Take `pg_advisory_xact_lock(hashtext(form_id || email))` in the submit transaction.
- **`search_text` must be rebuilt** if the registry's notion of a "text field" changes.
- **Cold-cache latency** on small VPS disks: first-load summaries at 100k reached about 1–1.6 s per query.
