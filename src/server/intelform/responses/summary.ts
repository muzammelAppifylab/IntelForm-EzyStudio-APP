import {
  MAX_SUMMARY_DAYS,
  daySpan,
  type ChoiceSummaryOption,
  type LatestAnswer,
  type QuestionData,
  type QuestionSummary,
  type SummaryQuery,
  type SummaryResponse,
} from '../../../lib/intelform/api-responses';
import {OTHER_OPTION_ID} from '../../../lib/intelform/form/definition';
import type {FieldType} from '../../../lib/intelform/form/field-types';
import {countryName} from '../../../lib/intelform/form/types/registry';
import {Prisma} from '../../../generated/prisma/client';
import type {PrismaClient} from '../../../platform/db';
import {cache} from '../../../platform/cache';
import type {CatalogEntry, FormCatalog} from './catalog';
import {displayAnswer} from './format';
import {summaryZone} from '../summary/math';
import {readSummarySums} from '../summary/read';
import {getAppSettings} from '../settings/settings';
import {addDays, rangeFragment, todayIn} from './query';

/**
 * GET /site-api/responses/forms/:id/summary: per-question aggregates, the funnel and the daily
 * series, in the app's time zone. The sums come from the per-day / per-month rollup kept by the
 * every-minute job plus the few responses it hasn't added yet (src/server/intelform/summary):
 * never a pass over every response. Medians of durations are from log buckets (approximate, the
 * UI shows "≈"). Labels, "(deleted option)" and percentages are added here.
 */

const sql = Prisma.sql;

const LATEST = new Set<FieldType>(['email', 'name', 'phone', 'address', 'short_text', 'long_text', 'url', 'date', 'time']);
/** The latest and "Other" answers are looked for among the form's newest responses in range only. */
const ANSWERS_WINDOW = 5_000;

const round1 = (n: number) => Math.round(n * 10) / 10;
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export class SummaryRangeError extends Error {}

/** The local-date range [from, to] of a summary request. `firstDay` is the form's first response day, for "all". */
export function summaryRange(q: SummaryQuery, today: string, firstDay: string | null): {from: string; to: string} {
  if (q.range === 'custom') {
    const from = q.from!;
    const to = q.to!;
    // The schema checks this too; the daily series is one row per day, so check again here.
    if (daySpan(from, to) + 1 > MAX_SUMMARY_DAYS) throw new SummaryRangeError('Pick a range of ten years or less.');
    return {from, to};
  }
  if (q.range === 'all')
    return {
      from: firstDay && firstDay < today ? firstDay : addDays(today, -6),
      to: today,
    };
  return {
    from: addDays(today, -(Number.parseInt(q.range, 10) - 1)),
    to: today,
  };
}

type LatestRow = {
  field_id: string;
  id: string;
  submitted_at: Date;
  val: unknown;
};

/**
 * Site Cache (docs/agent/cache.md):
 *   report:summary:<formId>:<range>:<from>:<to>:<tz>   1 min   the Summary tab's sums (read from
 *   the rollup, src/server/intelform/summary). The same for every RESPONSE_READ viewer of the
 *   form (days are in the app's time zone, not the viewer's). Cleared with `clearSummaryCache`
 *   when responses are deleted (one, a selection, a contact erase, retention) and on publish
 *   (the questions changed); a new response shows within a minute. A summary too big for the
 *   cache is simply not stored: the read is cheap either way.
 */
const SUMMARY_PREFIX = 'report:summary:';
const SUMMARY_TTL = 60;
const KEY_SAFE = /^[A-Za-z0-9_./:-]{0,64}$/;

/** The app's time zone (Settings → General): Summary days are in it, for every viewer. */
async function summaryTz(db: PrismaClient): Promise<string> {
  return summaryZone((await getAppSettings(db)).timezone);
}

/**
 * formSummary through the cache (a key from ids, the range and the zone only). Only the sums are
 * cached: the latest text answers and "Other" answers are what respondents typed (names,
 * emails…), never put in the cache, so they are read fresh beside it, for the questions that
 * have answers in range only, among the form's newest responses.
 */
export async function cachedFormSummary(db: PrismaClient, cat: FormCatalog, q: SummaryQuery): Promise<SummaryResponse> {
  const tz = await summaryTz(db);
  const parts = [q.range, q.from ?? '', q.to ?? '', tz];
  const agg = parts.every(p => KEY_SAFE.test(p))
    ? await cache.getOrSet(`${SUMMARY_PREFIX}${cat.form.id}:${parts.join(':')}`, SUMMARY_TTL, () => formSummary(db, cat, q, {answers: false, tz}))
    : await formSummary(db, cat, q, {answers: false, tz});
  const [latest, others] = await answerQueries(db, cat, agg);
  // formTotal from the catalog read on THIS request (exact: form_counts), not the cached copy,
  // so it never shows a count from before a delete or a new response.
  return {...withAnswers(agg, cat, latest, others), formTotal: cat.form.responseCount};
}

/** Puts the latest and "Other" answers into a summary built without them. */
export function withAnswers(s: SummaryResponse, cat: FormCatalog, latest: LatestRow[], others: LatestRow[]): SummaryResponse {
  const latestBy = groupByField(latest);
  const othersBy = groupByField(others);
  return {
    ...s,
    questions: s.questions.map(question => {
      const e = cat.byId.get(question.fieldId);
      if (!e) return question;
      if (question.data.kind === 'latest') return {...question, data: {kind: 'latest', items: latestItems(e, latestBy.get(e.meta.id) ?? [])}};
      if (question.data.kind === 'choice' && othersBy.has(e.meta.id)) {
        return {...question, data: {...question.data, other: otherItems(othersBy.get(e.meta.id) ?? [])}};
      }
      return question;
    }),
  };
}

function groupByField<T extends {field_id: string}>(rows: readonly T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) m.set(r.field_id, [...(m.get(r.field_id) ?? []), r]);
  return m;
}

/**
 * The 10 latest answers per text-like question, and per choice question whose "Other" was
 * picked, in range. Only questions the summary shows with answers (the rest would scan for
 * nothing), and only among the form's newest ANSWERS_WINDOW responses in range: one bound
 * computed once (an InitPlan), so each question's scan stops there.
 */
function answerQueries(db: PrismaClient, cat: FormCatalog, s: SummaryResponse): Promise<[LatestRow[], LatestRow[]]> {
  const latestIds = s.questions.filter(q => q.data.kind === 'latest' && q.answered > 0 && LATEST.has(q.type)).map(q => q.fieldId);
  const otherIds = s.questions
    .filter(q => q.data.kind === 'choice' && q.data.options.some(o => o.other && o.count > 0))
    .map(q => q.fieldId)
    .filter(id => {
      const t = cat.byId.get(id)?.meta.type;
      return t === 'single_choice' || t === 'multiple_choice';
    });
  if (!latestIds.length && !otherIds.length) return Promise.resolve([[], []]);
  const formId = cat.form.id;
  const range = rangeFragment(s.range.from, s.range.to, s.range.tz);
  const inForm = sql`form_id = ${formId}::uuid AND ${range} AND submitted_at >= coalesce((
      SELECT submitted_at FROM responses WHERE form_id = ${formId}::uuid AND ${range}
      ORDER BY submitted_at DESC, id DESC OFFSET ${ANSWERS_WINDOW - 1} LIMIT 1), '-infinity'::timestamptz)`;
  const ids = (list: string[]) => sql`(SELECT jsonb_array_elements_text(${JSON.stringify(list)}::jsonb) AS id)`;
  const latestQ = latestIds.length
    ? db.$queryRaw<LatestRow[]>`
        SELECT f.id AS field_id, t.* FROM ${ids(latestIds)} f CROSS JOIN LATERAL (
          SELECT id, submitted_at, answers->f.id AS val FROM responses
          WHERE ${inForm} AND answers ? f.id
          ORDER BY submitted_at DESC, id DESC LIMIT 10) t
      `
    : Promise.resolve([] as LatestRow[]);
  const othersQ = otherIds.length
    ? db.$queryRaw<LatestRow[]>`
        SELECT f.id AS field_id, t.* FROM ${ids(otherIds)} f CROSS JOIN LATERAL (
          SELECT id, submitted_at, answers->f.id AS val FROM responses
          WHERE ${inForm}
            AND (answers @> jsonb_build_object(f.id, jsonb_build_object('option', ${OTHER_OPTION_ID}::text))
              OR answers @> jsonb_build_object(f.id, jsonb_build_array(jsonb_build_object('option', ${OTHER_OPTION_ID}::text))))
          ORDER BY submitted_at DESC, id DESC LIMIT 10) t
      `
    : Promise.resolve([] as LatestRow[]);
  return Promise.all([latestQ, othersQ]);
}

/** After responses of a form (or, without an id, of any form) were deleted, or it was published. */
export async function clearSummaryCache(formId?: string): Promise<void> {
  await cache.delPrefix(formId ? `${SUMMARY_PREFIX}${formId}:` : SUMMARY_PREFIX);
}

/**
 * The Summary: sums from the rollup plus the responses not added up yet
 * (src/server/intelform/summary/read.ts), in the app's time zone. `answers: false` leaves the
 * latest / "Other" answers out (the cached part); otherwise they are read too.
 */
export async function formSummary(
  db: PrismaClient,
  cat: FormCatalog,
  q: SummaryQuery,
  opts: {answers?: boolean; tz?: string} = {}
): Promise<SummaryResponse> {
  const tz = opts.tz ?? (await summaryTz(db));
  const today = todayIn(tz);
  const open = q.range === 'all';
  // Checks a custom range before reading anything.
  const asked = open ? null : summaryRange(q, today, null);
  const sums = await readSummarySums(db, cat, {tz, today, open, from: asked?.from, to: asked?.to ?? today});
  const {from, to} = asked ?? summaryRange(q, today, sums.firstDay);

  const questions: QuestionSummary[] = [];
  for (const e of cat.entries) {
    const n = sums.answered.get(e.meta.id) ?? 0;
    // Deleted questions only appear while answers to them are in range.
    if (e.meta.deleted && n === 0) continue;
    const data = questionData(e, n, sums.choices.get(e.meta.id) ?? new Map(), sums.numbers.get(e.meta.id), [], []);
    const ttc = sums.ttcMedian.get(e.meta.id);
    questions.push({
      fieldId: e.meta.id,
      type: e.meta.type,
      label: e.meta.label,
      deleted: e.meta.deleted,
      answered: n,
      medianTimeMs: ttc === undefined ? null : Math.round(ttc),
      data,
    });
  }

  const series: SummaryResponse['series'] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) series.push({day, count: sums.series.get(day) ?? 0});
  const responses = sums.responses;
  const summary: SummaryResponse = {
    range: {preset: q.range, from, to, tz},
    totals: {
      views: sums.views,
      starts: sums.starts,
      responses,
      completionRate: sums.starts > 0 ? Math.min(responses / sums.starts, 1) : null,
      avgMs: sums.durationAvgMs === null ? null : Math.round(sums.durationAvgMs),
      medianMs: sums.durationMedianMs === null ? null : Math.round(sums.durationMedianMs),
    },
    series,
    questions,
    formTotal: cat.form.responseCount,
    asOf: sums.asOf,
  };
  if (opts.answers === false) return summary;
  const [latest, others] = await answerQueries(db, cat, summary);
  return withAnswers(summary, cat, latest, others);
}

const pct = (count: number, of: number) => (of > 0 ? round1((count / of) * 100) : 0);

function latestItems(e: CatalogEntry, rows: {id: string; submitted_at: Date; val: unknown}[]): LatestAnswer[] {
  return rows
    .map(r => ({
      responseId: r.id,
      submittedAt: r.submitted_at.toISOString(),
      text: displayAnswer(e.display, r.val).text,
    }))
    .filter(r => r.text !== '');
}

function otherItems(rows: {id: string; submitted_at: Date; val: unknown}[]) {
  return rows
    .map(r => ({
      responseId: r.id,
      submittedAt: (r.submitted_at instanceof Date ? r.submitted_at : new Date(r.submitted_at)).toISOString(),
      text: otherText(r.val),
    }))
    .filter(r => r.text !== '');
}

function otherText(val: unknown): string {
  const list = Array.isArray(val) ? val : [val];
  for (const x of list) {
    if (x && typeof x === 'object' && (x as {option?: unknown}).option === OTHER_OPTION_ID) {
      const t = (x as {other?: unknown}).other;
      return typeof t === 'string' ? t : '';
    }
  }
  return '';
}

/** Per-type card data. Exported for unit tests. */
export function questionData(
  e: CatalogEntry,
  answered: number,
  counts: Map<string, number>,
  numbers:
    | {
        n: number;
        avg: number | null;
        min: number | null;
        max: number | null;
        median: number | null;
      }
    | undefined,
  latest: {id: string; submitted_at: Date; val: unknown}[],
  others: {id: string; submitted_at: Date; val: unknown}[]
): QuestionData {
  const type = e.meta.type;
  switch (type) {
    case 'single_choice':
    case 'dropdown':
    case 'multiple_choice':
    case 'picture_choice':
    case 'yes_no': {
      const options: ChoiceSummaryOption[] = [];
      for (const o of e.meta.options ?? []) {
        const count = counts.get(o.id) ?? 0;
        // Deleted options only while they have answers.
        if (o.deleted && count === 0) continue;
        options.push({
          id: o.id,
          label: o.label,
          count,
          pct: pct(count, answered),
          ...(o.deleted && {deleted: true}),
          ...(o.id === OTHER_OPTION_ID && {other: true}),
        });
      }
      // Answers whose option is in no version (shouldn't happen): keep them countable.
      for (const [id, count] of counts) {
        if (!options.some(o => o.id === id)) {
          options.push({
            id,
            label: id === OTHER_OPTION_ID ? 'Other' : `${id} (deleted option)`,
            count,
            pct: pct(count, answered),
            deleted: id !== OTHER_OPTION_ID,
            ...(id === OTHER_OPTION_ID && {other: true}),
          });
        }
      }
      return {kind: 'choice', options, other: otherItems(others)};
    }
    case 'country': {
      const options = [...counts]
        .map(([id, count]) => ({
          id,
          label: countryName(id),
          count,
          pct: pct(count, answered),
        }))
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
      return {kind: 'choice', options, other: []};
    }
    case 'rating': {
      const scale = (e.display.props as {scale?: number}).scale ?? 5;
      const distribution = Array.from({length: scale}, (_, i) => ({
        value: i + 1,
        count: counts.get(String(i + 1)) ?? 0,
      }));
      const total = distribution.reduce((s, d) => s + d.count, 0);
      const satisfied = distribution.filter(d => d.value >= 4).reduce((s, d) => s + d.count, 0);
      return {
        kind: 'rating',
        scale,
        average: numbers?.avg == null ? null : round1(Number(numbers.avg)),
        distribution,
        // CSAT: share of 4 and 5 on a 5-point scale.
        csat: scale === 5 && total > 0 ? round1((satisfied / total) * 100) : null,
      };
    }
    case 'nps': {
      const distribution = Array.from({length: 11}, (_, i) => ({
        value: i,
        count: counts.get(String(i)) ?? 0,
      }));
      const sum = (lo: number, hi: number) => distribution.filter(d => d.value >= lo && d.value <= hi).reduce((s, d) => s + d.count, 0);
      const detractors = sum(0, 6);
      const passives = sum(7, 8);
      const promoters = sum(9, 10);
      const total = detractors + passives + promoters;
      // Same rounding as the dashboard's npsScore (Math.round), so card and score agree.
      const score = total > 0 ? Math.round(((promoters - detractors) / total) * 100) : null;
      return {
        kind: 'nps',
        score,
        detractors,
        passives,
        promoters,
        distribution,
      };
    }
    case 'number':
      return {
        kind: 'number',
        average: numbers?.avg == null ? null : round1(Number(numbers.avg)),
        min: num(numbers?.min),
        max: num(numbers?.max),
        median: numbers?.median == null ? null : round1(Number(numbers.median)),
      };
    case 'signature':
      return {kind: 'count', count: answered, noun: 'signed'};
    case 'consent':
      return {kind: 'count', count: answered, noun: 'accepted'};
    default:
      return {kind: 'latest', items: latestItems(e, latest)};
  }
}
