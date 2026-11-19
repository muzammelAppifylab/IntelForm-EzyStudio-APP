import {Prisma} from '../../../generated/prisma/client';
import type {PrismaClient} from '../../../platform/db';
import type {FormCatalog} from '../responses/catalog';
import {rangeFragment} from '../responses/query';
import {addDays, bucketMedian, DURATION_RATIO, fieldClasses, medianOf, planRange, TTC_RATIO} from './math';

/**
 * The Summary's sums for a range of local days (app time zone): the rollup rows
 * (form_summary_days, by month where a whole month is in range, else by day) plus the
 * responses not added up yet (past the form's watermark, read live and bounded), plus the funnel
 * events (folded days + the newest raw buckets). Three round trips, none of them over every
 * response: the state row, then the rollup / series / live tail / events together.
 */

const sql = Prisma.sql;

/** Live responses read per Summary (past the watermark), by width of the form. */
export function tailLimit(fieldCount: number): number {
  return Math.max(200, Math.min(5_000, Math.floor(200_000 / Math.max(fieldCount, 1))));
}

export interface SummarySums {
  responses: number;
  views: number;
  starts: number;
  durationAvgMs: number | null;
  /** Approximate (log buckets, about ±5%). */
  durationMedianMs: number | null;
  series: Map<string, number>;
  answered: Map<string, number>;
  choices: Map<string, Map<string, number>>;
  numbers: Map<string, {n: number; avg: number | null; min: number | null; max: number | null; median: number | null}>;
  /** Approximate (log buckets, about ±10%). */
  ttcMedian: Map<string, number>;
  /** Responses after this moment are not in the sums yet (too many to read live); null = all are. */
  asOf: string | null;
  /** The form's first local day with a response (All time), null without responses. */
  firstDay: string | null;
}

type Row = {day?: string | null; field_id: string; kind: string; key: string; n: number | null; s: number | null};
type StateRow = {
  gen: number | null;
  tz: string | null;
  wm_at: Date | null;
  wm_id: string | null;
  ev_wm: Date | null;
  first_day: string | null;
  starts_all: number | null;
};

/** Reads the sums for local days [from, to] (or, with `open`, everything up to `to`). */
export async function readSummarySums(
  db: PrismaClient,
  cat: FormCatalog,
  r: {tz: string; today: string; open: boolean; from?: string; to: string}
): Promise<SummarySums> {
  const formId = cat.form.id;
  const {tz} = r;
  const [st] = await db.$queryRaw<StateRow[]>`
    SELECT s.gen, s.tz, s.wm_at, s.wm_id::text AS wm_id, s.ev_wm,
      ${r.open ? sql`(SELECT to_char(min(submitted_at) AT TIME ZONE ${tz}, 'YYYY-MM-DD') FROM responses WHERE form_id = ${formId}::uuid)` : sql`NULL::text`} AS first_day,
      ${r.open ? sql`(SELECT coalesce(sum(starts), 0)::float8 FROM form_counts WHERE form_id = ${formId}::uuid)` : sql`NULL::float8`} AS starts_all
    FROM (SELECT 1) one LEFT JOIN form_summary_state s ON s.form_id = ${formId}::uuid
  `;
  const firstDay = st?.first_day ?? null;
  const from = r.open ? (firstDay && firstDay < r.today ? firstDay : addDays(r.today, -6)) : r.from!;
  const to = r.to;
  // The rollup counts only when its days are in this time zone.
  const usable = !!st && st.gen !== null && st.tz === tz;
  const gen = usable ? st!.gen! : -1;
  const wmAt = usable ? st!.wm_at : null;
  const wmId = usable ? st!.wm_id : null;
  const evWm = usable ? st!.ev_wm : null;

  const plan = planRange(from, to, r.today, r.open);
  const months = plan.months ? (r.open ? (['0001-01-01', plan.months[1]] as const) : plan.months) : null;
  const dayRun = (i: number) => plan.days[i] ?? [null, null];
  const [a1, a2] = dayRun(0);
  const [b1, b2] = dayRun(1);
  // All time: also the days before the first response (views of a form nobody answered yet).
  const allDays = r.open && !months ? (['0001-01-01', to] as const) : null;

  const rollupQ = usable
    ? db.$queryRaw<Row[]>`
        SELECT field_id, kind, key, sum(n)::float8 AS n, sum(s)::float8 AS s FROM form_summary_days
        WHERE form_id = ${formId}::uuid AND gen = ${gen} AND (
          (grain IN ('m', 'M') AND day BETWEEN ${months?.[0] ?? null}::date AND ${months?.[1] ?? null}::date)
          OR (grain IN ('d', 'D') AND day BETWEEN ${allDays?.[0] ?? a1}::date AND ${allDays?.[1] ?? a2}::date)
          OR (grain IN ('d', 'D') AND day BETWEEN ${b1}::date AND ${b2}::date))
        GROUP BY 1, 2, 3
      `
    : Promise.resolve([] as Row[]);
  const seriesQ = usable
    ? db.$queryRaw<{day: string; n: number}[]>`
        SELECT to_char(day, 'YYYY-MM-DD') AS day, n FROM form_summary_days
        WHERE form_id = ${formId}::uuid AND gen = ${gen} AND grain = 'D' AND day BETWEEN ${from}::date AND ${to}::date
          AND field_id = '' AND kind = 'r' AND key = ''
      `
    : Promise.resolve([] as {day: string; n: number}[]);

  // Responses past the watermark, in range, oldest first, at most `limit` of them.
  const classes = fieldClasses(cat);
  const limit = tailLimit(cat.entries.length);
  const beyond = wmAt
    ? sql`AND submitted_at >= ${wmAt} AND (submitted_at > ${wmAt} OR id > ${wmId}::uuid)`
    : sql``;
  const lower = r.open ? undefined : from;
  const arr = (ids: string[]) => sql`ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb))`;
  const tailQ = db.$queryRaw<(Row & {cnt: number; last_at: Date | null})[]>`
    SELECT x.cnt, x.last_at, c.day, c.field_id, c.kind, c.key, c.n, c.s
    FROM (
      SELECT count(*)::int AS cnt, max(t.submitted_at) FILTER (WHERE t.rn <= ${limit}) AS last_at,
        array_agg((t.submitted_at AT TIME ZONE ${tz})::date) FILTER (WHERE t.rn <= ${limit}) AS days,
        array_agg(t.answers) FILTER (WHERE t.rn <= ${limit}) AS answers,
        array_agg(t.ttc) FILTER (WHERE t.rn <= ${limit}) AS ttc,
        array_agg(t.duration_ms) FILTER (WHERE t.rn <= ${limit}) AS dur
      FROM (
        SELECT submitted_at, answers, ttc, duration_ms, row_number() OVER (ORDER BY submitted_at, id) AS rn
        FROM responses WHERE form_id = ${formId}::uuid AND ${rangeFragment(lower, to, tz)} ${beyond}
        ORDER BY submitted_at, id LIMIT ${limit + 1}
      ) t
    ) x
    LEFT JOIN LATERAL (
      SELECT CASE WHEN c.kind = 'r' THEN to_char(c.day, 'YYYY-MM-DD') END AS day, c.field_id, c.kind, c.key,
        sum(c.n)::float8 AS n, sum(c.s)::float8 AS s
      FROM form_summary_contrib(x.days, x.answers, x.ttc, x.dur, ${arr(classes.counted)}, ${arr(classes.numeric)}, ${arr(classes.exact)}) c
      GROUP BY 1, 2, 3, 4
    ) c ON true
  `;
  // Raw event buckets not folded into days yet.
  const lowTs = r.open ? sql`'-infinity'::timestamptz` : sql`(${from}::date::timestamp AT TIME ZONE ${tz})`;
  const eventsQ = db.$queryRaw<{views: number; starts: number}[]>`
    SELECT coalesce(sum(views), 0)::float8 AS views, coalesce(sum(starts), 0)::float8 AS starts FROM form_event_counts
    WHERE form_id = ${formId}::uuid AND bucket >= greatest(${evWm ?? null}::timestamptz, ${lowTs})
      AND bucket < ((${to}::date + 1)::timestamp AT TIME ZONE ${tz})
  `;
  const [rollup, series, tail, [events]] = await Promise.all([rollupQ, seriesQ, tailQ, eventsQ]);

  const sums = new Acc();
  for (const row of rollup) sums.add(row);
  const seriesBy = new Map<string, number>();
  for (const row of series) seriesBy.set(row.day, (seriesBy.get(row.day) ?? 0) + Number(row.n));
  let asOf: string | null = null;
  for (const row of tail) {
    if (row.cnt > limit && row.last_at) asOf = new Date(row.last_at).toISOString();
    if (!row.kind) continue;
    sums.add(row);
    if (row.kind === 'r' && row.day) seriesBy.set(row.day, (seriesBy.get(row.day) ?? 0) + Number(row.n));
  }
  return sums.result({
    from,
    to,
    series: seriesBy,
    views: sums.views + Number(events?.views ?? 0),
    starts: r.open && st?.starts_all !== null && st?.starts_all !== undefined ? Number(st.starts_all) : sums.starts + Number(events?.starts ?? 0),
    asOf,
    firstDay,
  });
}

/** Adds rollup and live rows together, then turns them into the Summary's numbers. */
class Acc {
  responses = 0;
  views = 0;
  starts = 0;
  durN = 0;
  durSum = 0;
  durHist = new Map<string, number>();
  answered = new Map<string, number>();
  choices = new Map<string, Map<string, number>>();
  numN = new Map<string, number>();
  numSum = new Map<string, number>();
  numValues = new Map<string, Map<string, number>>();
  ttc = new Map<string, Map<string, number>>();

  add(row: Row) {
    const n = Number(row.n ?? 0);
    if (!n) return;
    const s = Number(row.s ?? 0);
    const f = row.field_id;
    switch (row.kind) {
      case 'r':
        this.responses += n;
        break;
      case 'u':
        this.durN += n;
        this.durSum += s;
        break;
      case 'd':
        bump(this.durHist, row.key, n);
        break;
      case 'e':
        if (row.key === 'v') this.views += n;
        else if (row.key === 's') this.starts += n;
        break;
      case 'a':
        this.answered.set(f, (this.answered.get(f) ?? 0) + n);
        break;
      case 'c':
        bump(sub(this.choices, f), row.key, n);
        break;
      case 'v':
        this.numN.set(f, (this.numN.get(f) ?? 0) + n);
        this.numSum.set(f, (this.numSum.get(f) ?? 0) + s);
        break;
      case 'h':
        bump(sub(this.numValues, f), row.key, n);
        break;
      case 't':
        bump(sub(this.ttc, f), row.key, n);
        break;
    }
  }

  result(x: {from: string; to: string; series: Map<string, number>; views: number; starts: number; asOf: string | null; firstDay: string | null}): SummarySums {
    const numbers: SummarySums['numbers'] = new Map();
    for (const [f, n] of this.numN) {
      if (n <= 0) continue;
      const values = [...(this.numValues.get(f) ?? new Map<string, number>())]
        .map(([k, c]) => [Number(k), c] as [number, number])
        .filter(([v, c]) => c > 0 && Number.isFinite(v));
      numbers.set(f, {
        n,
        avg: (this.numSum.get(f) ?? 0) / n,
        min: values.length ? Math.min(...values.map(v => v[0])) : null,
        max: values.length ? Math.max(...values.map(v => v[0])) : null,
        median: medianOf(values),
      });
    }
    const ttcMedian = new Map<string, number>();
    for (const [f, buckets] of this.ttc) {
      const m = bucketMedian(buckets, TTC_RATIO);
      if (m !== null) ttcMedian.set(f, m);
    }
    const choices = new Map<string, Map<string, number>>();
    for (const [f, m] of this.choices) {
      const kept = new Map([...m].filter(([, c]) => c > 0));
      if (kept.size) choices.set(f, kept);
    }
    return {
      responses: this.responses,
      views: x.views,
      starts: x.starts,
      durationAvgMs: this.durN > 0 ? this.durSum / this.durN : null,
      durationMedianMs: bucketMedian(this.durHist, DURATION_RATIO),
      series: x.series,
      answered: new Map([...this.answered].filter(([, n]) => n > 0)),
      choices,
      numbers,
      ttcMedian,
      asOf: x.asOf,
      firstDay: x.firstDay,
    };
  }
}

function sub<K, K2, V>(m: Map<K, Map<K2, V>>, k: K): Map<K2, V> {
  let v = m.get(k);
  if (!v) m.set(k, (v = new Map()));
  return v;
}

function bump(m: Map<string, number>, k: string, n: number) {
  m.set(k, (m.get(k) ?? 0) + n);
}
