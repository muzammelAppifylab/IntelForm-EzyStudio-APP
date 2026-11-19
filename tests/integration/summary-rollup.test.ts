import {afterAll, beforeAll, describe, expect, it} from 'vitest';

import {summaryQuery, type SummaryResponse} from '../../src/lib/intelform/api-responses';
import {setCacheModeForTests} from '../../src/platform/cache';
import {loadCatalog, type FormCatalog} from '../../src/server/intelform/responses/catalog';
import {formSummary, questionData} from '../../src/server/intelform/responses/summary';
import {deleteResponses} from '../../src/server/intelform/responses/table';
import {clearAppSettingsCache} from '../../src/server/intelform/settings/settings';
import {refreshSummaryRollups} from '../../src/server/intelform/summary';
import {configureEnv, DATABASE_URL, db, resetDatabase} from './support/harness';

/**
 * The Summary rollup (form_summary_days) against a real Postgres: ~10k random responses over
 * ~4 months across every summarised type, then the Summary read from the rollup (+ live tail)
 * must equal the direct aggregates over every response (the pre-rollup SQL, kept below as the
 * reference) for many ranges, after deletes, updates, a time zone change and new responses.
 * Medians of durations / time per question come from log buckets: compared within their bound.
 */

const FORM = '00000000-0000-4000-8000-0000000d0001';
const V1 = '00000000-0000-4000-8000-0000000d0101';
const V2 = '00000000-0000-4000-8000-0000000d0102';
const N = 10_000;

const choice = (id: string, type: string, options: string[], other = false) => ({
  id,
  type,
  label: id,
  required: false,
  props: {options: options.map(o => ({id: o, label: o.toUpperCase()})), other},
});
const fieldsV1 = [
  choice('f_single01', 'single_choice', ['o_s1', 'o_s2', 'o_s3'], true),
  choice('f_multi001', 'multiple_choice', ['o_m1', 'o_m2', 'o_m3'], true),
  {id: 'f_yesno001', type: 'yes_no', label: 'Yes?', required: false, props: {}},
  {id: 'f_country1', type: 'country', label: 'Country', required: false, props: {}},
  {id: 'f_rating01', type: 'rating', label: 'Rating', required: false, props: {scale: 5}},
  {id: 'f_nps00001', type: 'nps', label: 'NPS', required: false, props: {}},
  {id: 'f_number01', type: 'number', label: 'Number', required: false, props: {}},
  {id: 'f_text0001', type: 'short_text', label: 'Text', required: false, props: {}},
  {id: 'f_email001', type: 'email', label: 'Email', required: false, props: {}},
  choice('f_old00001', 'dropdown', ['o_d1', 'o_d2']),
];
// Version 2 drops f_old00001 and option o_s3.
const fieldsV2 = [choice('f_single01', 'single_choice', ['o_s1', 'o_s2'], true), ...fieldsV1.slice(1, -1)];
const def = (fields: unknown[]) => JSON.stringify({layout: 'all_at_once', startScreen: {enabled: false}, endScreen: {title: 'Thanks'}, fields});

async function setTz(tz: string) {
  await db.$executeRaw`INSERT INTO intelform_settings (id, timezone) VALUES (1, ${tz}) ON CONFLICT (id) DO UPDATE SET timezone = EXCLUDED.timezone`;
  await clearAppSettingsCache();
}

/** `count` random responses submitted between `maxAgo` and `minAgo` ago. */
async function insertResponses(count: number, minAgo: string, maxAgo: string) {
  await db.$executeRaw`
    INSERT INTO responses (form_id, form_version_id, answers, submitted_at, duration_ms, ttc)
    SELECT ${FORM}::uuid, x.v, jsonb_strip_nulls(jsonb_build_object(
        'f_single01', CASE WHEN random() < 0.9 THEN (CASE WHEN random() < 0.1 THEN jsonb_build_object('option', 'o_other', 'other', 'other ' || x.g)
          ELSE jsonb_build_object('option', (ARRAY['o_s1', 'o_s2', 'o_s3'])[1 + floor(random() * 3)::int]) END) END,
        'f_multi001', (SELECT jsonb_agg(jsonb_build_object('option', o)) FROM unnest(ARRAY['o_m1', 'o_m2', 'o_m3', 'o_other']) o WHERE random() < 0.4 AND x.g > 0),
        'f_yesno001', CASE WHEN random() < 0.8 THEN to_jsonb(random() < 0.5) END,
        'f_country1', CASE WHEN random() < 0.7 THEN to_jsonb((ARRAY['DE', 'GB', 'US', 'FR'])[1 + floor(random() * 4)::int]) END,
        'f_rating01', CASE WHEN random() < 0.85 THEN to_jsonb(1 + floor(random() * 5)::int) END,
        'f_nps00001', CASE WHEN random() < 0.85 THEN to_jsonb(floor(random() * 11)::int) END,
        'f_number01', CASE WHEN random() < 0.02 THEN to_jsonb('n/a'::text) WHEN random() < 0.8 THEN to_jsonb(round((random() * 300 - 50)::numeric, (x.g % 3))) END,
        'f_text0001', CASE WHEN random() < 0.5 THEN to_jsonb('hello ' || x.g) END,
        'f_email001', CASE WHEN random() < 0.6 THEN to_jsonb('p' || x.g || '@example.com') END,
        'f_old00001', CASE WHEN x.v = ${V1}::uuid AND random() < 0.9 THEN jsonb_build_object('option', (ARRAY['o_d1', 'o_d2'])[1 + floor(random() * 2)::int]) END
      )),
      x.at,
      CASE WHEN random() < 0.9 THEN (500 + random() * random() * 900000)::int WHEN random() < 0.5 THEN 90000000 END,
      CASE WHEN random() < 0.8 THEN jsonb_strip_nulls(jsonb_build_object(
        'f_single01', (300 + random() * 30000)::int, 'f_rating01', (100 + random() * 5000)::int,
        'f_text0001', CASE WHEN random() < 0.5 THEN (1000 + random() * 90000)::int END)) END
    FROM (
      SELECT g, now() - ${minAgo}::interval - random() * (${maxAgo}::interval - ${minAgo}::interval) AS at,
        CASE WHEN g % 3 = 0 THEN ${V1}::uuid ELSE ${V2}::uuid END AS v
      FROM generate_series(1, ${count}) g
    ) x
  `;
}

async function refreshAll() {
  let runs = 0;
  // A tiny budget: one step per run, so the watermark resumes across runs.
  for (;;) {
    const r = await refreshSummaryRollups(db, {budgetMs: 1});
    runs++;
    if (!r.more) break;
    if (runs > 500) throw new Error('refresh never finished');
  }
  return runs;
}

type Ref = {
  responses: number;
  avgMs: number | null;
  medianMs: number | null;
  series: Map<string, number>;
  views: number;
  starts: number;
  answered: Map<string, number>;
  counts: Map<string, Map<string, number>>;
  numbers: Map<string, {n: number; avg: number | null; min: number | null; max: number | null; median: number | null}>;
  ttc: Map<string, number>;
};

/** The pre-rollup Summary SQL: aggregates over every response in [from, to] (local days in tz). */
async function direct(cat: FormCatalog, from: string, to: string, tz: string, all: boolean): Promise<Ref> {
  const ids = (types: string[]) => cat.entries.filter(e => types.includes(e.meta.type)).map(e => e.meta.id);
  const counted = ids(['single_choice', 'dropdown', 'multiple_choice', 'picture_choice', 'yes_no', 'country', 'rating', 'nps']);
  const numeric = ids(['number', 'rating', 'nps']);
  const lo = `${from}`;
  const hi = `${to}`;
  const [top] = await db.$queryRaw<{responses: number; avg_ms: number | null; median_ms: number | null}[]>`
    SELECT count(*)::int AS responses, (avg(duration_ms) FILTER (WHERE duration_ms < 86400000))::float8 AS avg_ms,
      (percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms))::float8 AS median_ms
    FROM responses WHERE form_id = ${FORM}::uuid AND submitted_at >= (${lo}::date::timestamp AT TIME ZONE ${tz})
      AND submitted_at < ((${hi}::date + 1)::timestamp AT TIME ZONE ${tz})`;
  const series = await db.$queryRaw<{day: string; n: number}[]>`
    SELECT to_char((submitted_at AT TIME ZONE ${tz})::date, 'YYYY-MM-DD') AS day, count(*)::int AS n FROM responses
    WHERE form_id = ${FORM}::uuid AND submitted_at >= (${lo}::date::timestamp AT TIME ZONE ${tz})
      AND submitted_at < ((${hi}::date + 1)::timestamp AT TIME ZONE ${tz}) GROUP BY 1`;
  const choices = await db.$queryRaw<{field_id: string; option_id: string | null; n: number}[]>`
    SELECT f.id AS field_id, c->>'option' AS option_id, count(*)::int AS n
    FROM responses r CROSS JOIN unnest(${counted}::text[]) f(id)
    CROSS JOIN LATERAL jsonb_array_elements(CASE jsonb_typeof(r.answers->f.id)
       WHEN 'array' THEN r.answers->f.id WHEN 'object' THEN jsonb_build_array(r.answers->f.id)
       ELSE jsonb_build_array(jsonb_build_object('option', r.answers->f.id)) END) c
    WHERE r.form_id = ${FORM}::uuid AND r.submitted_at >= (${lo}::date::timestamp AT TIME ZONE ${tz})
      AND r.submitted_at < ((${hi}::date + 1)::timestamp AT TIME ZONE ${tz}) AND r.answers ? f.id GROUP BY 1, 2`;
  const answered = await db.$queryRaw<{field_id: string; answered: number}[]>`
    SELECT k AS field_id, count(*)::int AS answered FROM responses r CROSS JOIN LATERAL jsonb_object_keys(r.answers) k
    WHERE r.form_id = ${FORM}::uuid AND r.submitted_at >= (${lo}::date::timestamp AT TIME ZONE ${tz})
      AND r.submitted_at < ((${hi}::date + 1)::timestamp AT TIME ZONE ${tz}) GROUP BY 1`;
  const numbers = await db.$queryRaw<{field_id: string; n: number; avg: number | null; min: number | null; max: number | null; median: number | null}[]>`
    SELECT e.key AS field_id, count(*)::int AS n, avg(e.value::numeric)::float8 AS avg, min(e.value::numeric)::float8 AS min,
      max(e.value::numeric)::float8 AS max, (percentile_cont(0.5) WITHIN GROUP (ORDER BY e.value::numeric))::float8 AS median
    FROM responses r CROSS JOIN LATERAL jsonb_each(r.answers) e
    WHERE r.form_id = ${FORM}::uuid AND r.submitted_at >= (${lo}::date::timestamp AT TIME ZONE ${tz})
      AND r.submitted_at < ((${hi}::date + 1)::timestamp AT TIME ZONE ${tz}) AND e.key = ANY(${numeric}::text[])
      AND jsonb_typeof(e.value) = 'number'
    GROUP BY 1`;
  const ttc = await db.$queryRaw<{field_id: string; median: number}[]>`
    SELECT e.key AS field_id, (percentile_cont(0.5) WITHIN GROUP (ORDER BY e.value::numeric))::float8 AS median
    FROM responses r CROSS JOIN LATERAL jsonb_each(r.ttc) e
    WHERE r.form_id = ${FORM}::uuid AND r.submitted_at >= (${lo}::date::timestamp AT TIME ZONE ${tz})
      AND r.submitted_at < ((${hi}::date + 1)::timestamp AT TIME ZONE ${tz}) AND r.ttc IS NOT NULL AND jsonb_typeof(r.ttc) = 'object'
      AND jsonb_typeof(e.value) = 'number'
    GROUP BY 1`;
  const [funnel] = all
    ? await db.$queryRaw<{views: number; starts: number}[]>`
        SELECT (SELECT coalesce(sum(views), 0)::int FROM form_event_counts WHERE form_id = ${FORM}::uuid) AS views,
          (SELECT coalesce(sum(starts), 0)::int FROM form_counts WHERE form_id = ${FORM}::uuid) AS starts`
    : await db.$queryRaw<{views: number; starts: number}[]>`
        SELECT coalesce(sum(views), 0)::int AS views, coalesce(sum(starts), 0)::int AS starts FROM form_event_counts
        WHERE form_id = ${FORM}::uuid AND bucket >= (${lo}::date::timestamp AT TIME ZONE ${tz})
          AND bucket < ((${hi}::date + 1)::timestamp AT TIME ZONE ${tz})`;
  const counts = new Map<string, Map<string, number>>();
  for (const r of choices) {
    if (r.option_id === null) continue;
    const m = counts.get(r.field_id) ?? new Map<string, number>();
    m.set(r.option_id, (m.get(r.option_id) ?? 0) + Number(r.n));
    counts.set(r.field_id, m);
  }
  return {
    responses: Number(top!.responses),
    avgMs: top!.avg_ms === null ? null : Math.round(Number(top!.avg_ms)),
    medianMs: top!.median_ms === null ? null : Number(top!.median_ms),
    series: new Map(series.map(r => [r.day, Number(r.n)])),
    views: Number(funnel!.views),
    starts: Number(funnel!.starts),
    answered: new Map(answered.map(r => [r.field_id, Number(r.answered)])),
    counts,
    numbers: new Map(numbers.map(r => [r.field_id, r])),
    ttc: new Map(ttc.map(r => [r.field_id, Number(r.median)])),
  };
}

const near = (actual: number | null, expected: number | null, rel: number, what: string) => {
  if (expected === null) return expect(actual, what).toBeNull();
  expect(actual, what).not.toBeNull();
  expect(Math.abs(actual! - expected), `${what}: ${actual} vs ${expected}`).toBeLessThanOrEqual(Math.max(rel * Math.abs(expected), 1));
};

/** The Summary (no latest answers) equals the direct aggregates over [from, to]. */
async function check(range: {range: string; from?: string; to?: string}, tz: string) {
  const cat = (await loadCatalog(db, FORM))!;
  const s: SummaryResponse = await formSummary(db, cat, summaryQuery.parse(range), {answers: false});
  expect(s.range.tz).toBe(tz);
  expect(s.asOf, `asOf ${JSON.stringify(range)}`).toBeNull();
  const ref = await direct(cat, s.range.from, s.range.to, tz, range.range === 'all');
  const label = JSON.stringify(range);
  expect(s.totals.responses, label).toBe(ref.responses);
  expect(s.totals.views, label).toBe(ref.views);
  expect(s.totals.starts, label).toBe(ref.starts);
  near(s.totals.avgMs, ref.avgMs, 0, `${label} avg`);
  near(s.totals.medianMs, ref.medianMs, 0.06, `${label} median`);
  expect(s.series.reduce((a, d) => a + d.count, 0), label).toBe(ref.responses);
  for (const d of s.series) expect(d.count, `${label} ${d.day}`).toBe(ref.series.get(d.day) ?? 0);
  for (const q of s.questions) {
    const e = cat.byId.get(q.fieldId)!;
    const answered = ref.answered.get(q.fieldId) ?? 0;
    expect(q.answered, `${label} ${q.fieldId}`).toBe(answered);
    const want = questionData(e, answered, ref.counts.get(q.fieldId) ?? new Map(), ref.numbers.get(q.fieldId), [], []);
    expect(q.data, `${label} ${q.fieldId}`).toEqual(want);
    const t = ref.ttc.get(q.fieldId);
    near(q.medianTimeMs, t === undefined ? null : t, 0.11, `${label} ${q.fieldId} time`);
  }
  // Every answered field of the form is there (deleted ones only with answers).
  expect(s.questions.map(q => q.fieldId).sort()).toEqual(cat.entries.filter(e => !e.meta.deleted || (ref.answered.get(e.meta.id) ?? 0) > 0).map(e => e.meta.id).sort());
  return s;
}

/** Local dates in tz relative to today. */
function day(tz: string, offset: number): string {
  const today = new Intl.DateTimeFormat('en-CA', {timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date());
  const [y, m, d] = today.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + offset)).toISOString().slice(0, 10);
}

const RANGES = (tz: string) => {
  const t = day(tz, 0);
  const monthStart = `${t.slice(0, 7)}-01`;
  const prevMonthStart = (() => {
    const [y, m] = t.split('-').map(Number);
    return new Date(Date.UTC(y!, m! - 2, 1)).toISOString().slice(0, 10);
  })();
  return [
    {range: '7d'},
    {range: '30d'},
    {range: '90d'},
    {range: 'all'},
    {range: 'custom', from: day(tz, -100), to: day(tz, -40)},
    {range: 'custom', from: day(tz, -63), to: day(tz, -63)},
    {range: 'custom', from: prevMonthStart, to: day(tz, 0)},
    {range: 'custom', from: monthStart, to: day(tz, 5)},
    {range: 'custom', from: prevMonthStart, to: new Date(Date.parse(monthStart) - 86_400_000).toISOString().slice(0, 10)},
    {range: 'custom', from: '2021-01-01', to: '2030-12-31'},
  ];
};

describe.skipIf(!DATABASE_URL)('summary rollup (integration, real Postgres)', () => {
  beforeAll(async () => {
    configureEnv();
    setCacheModeForTests('memory');
    await resetDatabase();
    await db.$executeRaw`DELETE FROM form_summary_state`;
    await db.$executeRaw`
      INSERT INTO forms (id, slug, title, status, draft) VALUES (${FORM}::uuid, 'rollup', 'Rollup', 'live', ${def(fieldsV2)}::jsonb)`;
    await db.$executeRaw`
      INSERT INTO form_versions (id, form_id, version, definition, theme) VALUES
        (${V1}::uuid, ${FORM}::uuid, 1, ${def(fieldsV1)}::jsonb, '{}'::jsonb),
        (${V2}::uuid, ${FORM}::uuid, 2, ${def(fieldsV2)}::jsonb, '{}'::jsonb)`;
    await db.$executeRaw`UPDATE forms SET published_version_id = ${V2}::uuid WHERE id = ${FORM}::uuid`;
    await setTz('America/New_York');
    await insertResponses(N, '3 minutes', '120 days');
    // Funnel buckets: 15-minute buckets over the same months, in random shards.
    await db.$executeRaw`
      INSERT INTO form_event_counts (form_id, bucket, shard, views, starts)
      SELECT ${FORM}::uuid, b, sh, sum(v)::int, sum(st)::int FROM (
        SELECT date_bin('15 minutes', now() - random() * interval '130 days', '2000-01-01'::timestamptz) AS b,
          floor(random() * 16)::smallint AS sh, 1 + floor(random() * 20)::int AS v, floor(random() * 10)::int AS st
        FROM generate_series(1, 4000)) e
      GROUP BY b, sh`;
    await db.$executeRaw`
      UPDATE form_counts SET starts = (SELECT sum(starts) FROM form_event_counts WHERE form_id = ${FORM}::uuid)
      WHERE form_id = ${FORM}::uuid AND shard = (SELECT min(shard) FROM form_counts WHERE form_id = ${FORM}::uuid)`;
  }, 120_000);
  afterAll(async () => {
    setCacheModeForTests(null);
    await db.$disconnect();
  });

  it('reads live while nothing is added up: exact for a small range, marked partial for a big one', async () => {
    const cat = (await loadCatalog(db, FORM))!;
    const big = await formSummary(db, cat, summaryQuery.parse({range: 'all'}), {answers: false});
    expect(big.asOf).not.toBeNull();
    await check({range: 'custom', from: day('America/New_York', -63), to: day('America/New_York', -63)}, 'America/New_York');
  });

  it('adds every response up over several runs and matches the direct aggregates for every range', async () => {
    const runs = await refreshAll();
    expect(runs).toBeGreaterThan(3);
    const [st] = await db.$queryRaw<{wm_at: Date; n: number}[]>`
      SELECT s.wm_at, (SELECT count(*)::int FROM responses WHERE form_id = s.form_id AND submitted_at <= s.wm_at) AS n
      FROM form_summary_state s WHERE form_id = ${FORM}::uuid`;
    expect(st!.n).toBe(N);
    for (const range of RANGES('America/New_York')) await check(range, 'America/New_York');
  }, 120_000);

  it('counts new responses live before the job adds them, then the same after', async () => {
    await insertResponses(40, '0 minutes', '1 minute');
    await check({range: '7d'}, 'America/New_York');
    await check({range: 'all'}, 'America/New_York');
    await refreshAll();
    await check({range: '30d'}, 'America/New_York');
  }, 60_000);

  it('stays right through single, bulk, contact-style and retention-style deletes', async () => {
    const ids = await db.$queryRaw<{id: string}[]>`SELECT id::text AS id FROM responses WHERE form_id = ${FORM}::uuid ORDER BY random() LIMIT 400`;
    expect((await deleteResponses(db, FORM, [ids[0]!.id])).deleted).toBe(1);
    expect((await deleteResponses(db, FORM, ids.slice(1, 300).map(r => r.id))).deleted).toBe(299);
    await db.$executeRaw`DELETE FROM responses WHERE id = ANY(${ids.slice(300).map(r => r.id)}::uuid[])`;
    // Retention: the oldest days go whole.
    await db.$executeRaw`DELETE FROM responses WHERE id IN (SELECT id FROM responses WHERE submitted_at < now() - interval '110 days' ORDER BY submitted_at LIMIT 500)`;
    for (const range of RANGES('America/New_York')) await check(range, 'America/New_York');
  }, 120_000);

  it('follows an edit of answers (nothing edits them today)', async () => {
    await db.$executeRaw`
      UPDATE responses SET answers = answers || '{"f_rating01": 5, "f_single01": {"option": "o_s1"}}'::jsonb, duration_ms = 1234
      WHERE id IN (SELECT id FROM responses WHERE form_id = ${FORM}::uuid ORDER BY random() LIMIT 50)`;
    await check({range: '90d'}, 'America/New_York');
    await check({range: 'all'}, 'America/New_York');
  }, 60_000);

  it('holds exactly the rows a fresh rebuild makes (no drift, no zero rows)', async () => {
    const snapshot = () => db.$queryRaw<{k: string; n: number; s: string | null}[]>`
      SELECT concat_ws('|', grain, day, field_id, kind, key) AS k, n, s::text AS s FROM form_summary_days
      WHERE form_id = ${FORM}::uuid ORDER BY 1`;
    const before = await snapshot();
    expect(before.some(r => r.n === 0)).toBe(false);
    await db.$executeRaw`DELETE FROM form_summary_days WHERE form_id = ${FORM}::uuid`;
    await db.$executeRaw`UPDATE form_summary_state SET wm_at = NULL, wm_id = NULL, ev_wm = NULL WHERE form_id = ${FORM}::uuid`;
    await refreshAll();
    const after = await snapshot();
    expect(after.length).toBe(before.length);
    expect(after).toEqual(before);
  }, 120_000);

  it('moves to the app time zone when it changes (a new generation; old rows removed)', async () => {
    await setTz('Asia/Kolkata');
    const cat = (await loadCatalog(db, FORM))!;
    // Before the job ran: the old rollup isn't used (wrong days), the live read is marked partial.
    expect((await formSummary(db, cat, summaryQuery.parse({range: 'all'}), {answers: false})).asOf).not.toBeNull();
    await refreshAll();
    const [g] = await db.$queryRaw<{gens: number}[]>`SELECT count(DISTINCT gen)::int AS gens FROM form_summary_days WHERE form_id = ${FORM}::uuid`;
    expect(g!.gens).toBe(1);
    for (const range of RANGES('Asia/Kolkata')) await check(range, 'Asia/Kolkata');
  }, 120_000);

  it('drops everything with the form (no trigger error on the cascade)', async () => {
    await db.$executeRaw`DELETE FROM forms WHERE id = ${FORM}::uuid`;
    const [left] = await db.$queryRaw<{n: number}[]>`SELECT count(*)::int AS n FROM form_summary_days`;
    expect(left!.n).toBe(0);
    expect((await refreshSummaryRollups(db, {budgetMs: 5_000})).more).toBe(false);
  });
});
