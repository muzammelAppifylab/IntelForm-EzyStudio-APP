import {
  MAX_SUMMARY_DAYS,
  daySpan,
  type ChoiceSummaryOption,
  type LatestAnswer,
  type QuestionData,
  type QuestionSummary,
  type SummaryQuery,
  type SummaryResponse,
} from '../../shared/api-responses'
import { OTHER_OPTION_ID } from '../../shared/form/definition'
import type { FieldType } from '../../shared/form/field-types'
import { countryName } from '../../shared/form/types/registry'
import { sql } from '../db/client'
import { ApiError } from '../lib/errors'
import { loadCatalog, type CatalogEntry } from './catalog'
import { displayAnswer } from './format'
import { addDays, rangeFragment, safeTz, todayIn } from './query'

/**
 * GET /api/forms/:id/summary: the SQL from docs/research/05-data-analytics.md "Summary queries",
 * run in parallel on the pool. Labels, "(deleted option)" and percentages are added here.
 */

const COUNTED = new Set<FieldType>(['single_choice', 'dropdown', 'multiple_choice', 'picture_choice', 'yes_no', 'country', 'rating', 'nps'])
const NUMERIC = new Set<FieldType>(['number', 'rating', 'nps'])
const LATEST = new Set<FieldType>(['email', 'name', 'phone', 'address', 'short_text', 'long_text', 'url', 'date', 'time'])

const round1 = (n: number) => Math.round(n * 10) / 10
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))

export async function formSummary(formId: string, q: SummaryQuery): Promise<SummaryResponse> {
  const cat = await loadCatalog(formId)
  const tz = await safeTz(q.tz)
  const today = todayIn(tz)
  let from: string
  let to = today
  if (q.range === 'custom') {
    from = q.from!
    to = q.to!
    // The schema checks this too; the daily series below is one row per day, so check again here.
    if (daySpan(from, to) + 1 > MAX_SUMMARY_DAYS) throw new ApiError(422, 'validation_failed', 'Pick a range of ten years or less')
  } else if (q.range === 'all') {
    const [first] = await sql<{ day: string | null }[]>`
      SELECT to_char(min(submitted_at) AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS day FROM responses WHERE form_id = ${formId}
    `
    from = first?.day && first.day < today ? first.day : addDays(today, -6)
  } else {
    from = addDays(today, -(Number.parseInt(q.range, 10) - 1))
  }
  const range = rangeFragment(from, to, tz)
  const ids = (pred: (t: FieldType) => boolean) => cat.entries.filter((e) => pred(e.meta.type)).map((e) => e.meta.id)
  const countedIds = ids((t) => COUNTED.has(t))
  const numericIds = ids((t) => NUMERIC.has(t))
  const latestIds = ids((t) => LATEST.has(t))
  const otherIds = cat.entries
    .filter((e) => ['single_choice', 'multiple_choice'].includes(e.meta.type) && e.meta.options?.some((o) => o.id === OTHER_OPTION_ID))
    .map((e) => e.meta.id)

  const [top, series, choices, answered, numbers, latest, others, funnel, ttc, [{ form_total }]] = await Promise.all([
    sql<{ responses: number; avg_ms: string | null; median_ms: number | null }[]>`
      SELECT count(*)::int AS responses, avg(duration_ms) FILTER (WHERE duration_ms < 86400000) AS avg_ms,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms) AS median_ms
      FROM responses WHERE form_id = ${formId} AND ${range}
    `,
    sql<{ day: string; n: number }[]>`
      SELECT to_char(d, 'YYYY-MM-DD') AS day, coalesce(c.n, 0)::int AS n
      FROM generate_series(${from}::date, ${to}::date, interval '1 day') d
      LEFT JOIN (SELECT (submitted_at AT TIME ZONE ${tz})::date AS day, count(*) n
                 FROM responses WHERE form_id = ${formId} AND ${range} GROUP BY 1) c ON c.day = d::date
      ORDER BY d
    `,
    countedIds.length
      ? sql<{ field_id: string; option_id: string | null; n: number }[]>`
          SELECT f.id AS field_id, c->>'option' AS option_id, count(*)::int AS n
          FROM responses r CROSS JOIN unnest(${sql.array(countedIds)}::text[]) f(id)
          CROSS JOIN LATERAL jsonb_array_elements(CASE jsonb_typeof(r.answers->f.id)
             WHEN 'array' THEN r.answers->f.id WHEN 'object' THEN jsonb_build_array(r.answers->f.id)
             ELSE jsonb_build_array(jsonb_build_object('option', r.answers->f.id)) END) c
          WHERE r.form_id = ${formId} AND ${range} AND r.answers ? f.id GROUP BY 1, 2
        `
      : [],
    sql<{ field_id: string; answered: number }[]>`
      SELECT k AS field_id, count(*)::int AS answered FROM responses r CROSS JOIN LATERAL jsonb_object_keys(r.answers) k
      WHERE r.form_id = ${formId} AND ${range} GROUP BY 1
    `,
    numericIds.length
      ? sql<{ field_id: string; n: number; avg: string | null; min: string | null; max: string | null; median: number | null }[]>`
          SELECT e.key AS field_id, count(*)::int AS n, avg(e.value::numeric) AS avg, min(e.value::numeric) AS min,
            max(e.value::numeric) AS max, percentile_cont(0.5) WITHIN GROUP (ORDER BY e.value::numeric) AS median
          FROM responses r CROSS JOIN LATERAL jsonb_each(r.answers) e
          WHERE r.form_id = ${formId} AND ${range} AND e.key = ANY(${sql.array(numericIds)}::text[])
            AND jsonb_typeof(e.value) = 'number'
          GROUP BY 1
        `
      : [],
    latestIds.length
      ? sql<{ field_id: string; id: string; submitted_at: Date; val: unknown }[]>`
          SELECT f.id AS field_id, t.* FROM unnest(${sql.array(latestIds)}::text[]) f(id) CROSS JOIN LATERAL (
            SELECT id, submitted_at, answers->f.id AS val FROM responses
            WHERE form_id = ${formId} AND ${range} AND answers ? f.id
            ORDER BY submitted_at DESC, id DESC LIMIT 10) t
        `
      : [],
    otherIds.length
      ? sql<{ field_id: string; id: string; submitted_at: Date; val: unknown }[]>`
          SELECT f.id AS field_id, t.* FROM unnest(${sql.array(otherIds)}::text[]) f(id) CROSS JOIN LATERAL (
            SELECT id, submitted_at, answers->f.id AS val FROM responses
            WHERE form_id = ${formId} AND ${range}
              AND (answers @> jsonb_build_object(f.id, jsonb_build_object('option', ${OTHER_OPTION_ID}::text))
                OR answers @> jsonb_build_object(f.id, jsonb_build_array(jsonb_build_object('option', ${OTHER_OPTION_ID}::text))))
            ORDER BY submitted_at DESC, id DESC LIMIT 10) t
        `
      : [],
    sql<{ views: number; starts: number }[]>`
      SELECT coalesce(sum(views), 0)::int AS views, coalesce(sum(starts), 0)::int AS starts FROM form_event_counts
      WHERE form_id = ${formId} AND bucket >= (${from}::date::timestamp AT TIME ZONE ${tz})
        AND bucket < ((${to}::date + 1)::timestamp AT TIME ZONE ${tz})
    `,
    sql<{ field_id: string; median: number }[]>`
      SELECT e.key AS field_id, percentile_cont(0.5) WITHIN GROUP (ORDER BY e.value::numeric) AS median
      FROM responses r CROSS JOIN LATERAL jsonb_each(r.ttc) e
      WHERE r.form_id = ${formId} AND ${range} AND r.ttc IS NOT NULL AND jsonb_typeof(r.ttc) = 'object'
        AND jsonb_typeof(e.value) = 'number'
      GROUP BY 1
    `,
    sql<{ form_total: number }[]>`SELECT count(*)::int AS form_total FROM responses WHERE form_id = ${formId}`,
  ])

  const answeredBy = new Map(answered.map((r) => [r.field_id, r.answered]))
  const countsBy = new Map<string, Map<string, number>>()
  for (const r of choices) {
    if (r.option_id === null) continue
    const m = countsBy.get(r.field_id) ?? new Map<string, number>()
    m.set(r.option_id, (m.get(r.option_id) ?? 0) + r.n)
    countsBy.set(r.field_id, m)
  }
  const numbersBy = new Map(numbers.map((r) => [r.field_id, r]))
  const ttcBy = new Map(ttc.map((r) => [r.field_id, Number(r.median)]))
  const group = <T extends { field_id: string }>(rows: readonly T[]) => {
    const m = new Map<string, T[]>()
    for (const r of rows) m.set(r.field_id, [...(m.get(r.field_id) ?? []), r])
    return m
  }
  const latestBy = group(latest)
  const othersBy = group(others)

  const questions: QuestionSummary[] = []
  for (const e of cat.entries) {
    const n = answeredBy.get(e.meta.id) ?? 0
    // Deleted questions only appear while answers to them are in range.
    if (e.meta.deleted && n === 0) continue
    const data = questionData(e, n, countsBy.get(e.meta.id) ?? new Map(), numbersBy.get(e.meta.id), latestBy.get(e.meta.id) ?? [], othersBy.get(e.meta.id) ?? [])
    questions.push({
      fieldId: e.meta.id,
      type: e.meta.type,
      label: e.meta.label,
      deleted: e.meta.deleted,
      answered: n,
      medianTimeMs: ttcBy.has(e.meta.id) ? Math.round(ttcBy.get(e.meta.id)!) : null,
      data,
    })
  }

  const t = top[0]
  const { views, starts } = funnel[0] ?? { views: 0, starts: 0 }
  return {
    range: { preset: q.range, from, to, tz },
    totals: {
      views,
      starts,
      responses: t.responses,
      completionRate: starts > 0 ? Math.min(t.responses / starts, 1) : null,
      avgMs: t.avg_ms === null ? null : Math.round(Number(t.avg_ms)),
      medianMs: t.median_ms === null ? null : Math.round(Number(t.median_ms)),
    },
    series: series.map((r) => ({ day: r.day, count: r.n })),
    questions,
    formTotal: form_total,
  }
}

const pct = (count: number, of: number) => (of > 0 ? round1((count / of) * 100) : 0)

function latestItems(e: CatalogEntry, rows: { id: string; submitted_at: Date; val: unknown }[]): LatestAnswer[] {
  return rows
    .map((r) => ({ responseId: r.id, submittedAt: r.submitted_at.toISOString(), text: displayAnswer(e.display, r.val).text }))
    .filter((r) => r.text !== '')
}

function otherText(val: unknown): string {
  const list = Array.isArray(val) ? val : [val]
  for (const x of list) {
    if (x && typeof x === 'object' && (x as { option?: unknown }).option === OTHER_OPTION_ID) {
      const t = (x as { other?: unknown }).other
      return typeof t === 'string' ? t : ''
    }
  }
  return ''
}

/** Per-type card data. Exported for unit tests. */
export function questionData(
  e: CatalogEntry,
  answered: number,
  counts: Map<string, number>,
  numbers: { n: number; avg: string | null; min: string | null; max: string | null; median: number | null } | undefined,
  latest: { id: string; submitted_at: Date; val: unknown }[],
  others: { id: string; submitted_at: Date; val: unknown }[],
): QuestionData {
  const type = e.meta.type
  switch (type) {
    case 'single_choice':
    case 'dropdown':
    case 'multiple_choice':
    case 'picture_choice':
    case 'yes_no': {
      const options: ChoiceSummaryOption[] = []
      for (const o of e.meta.options ?? []) {
        const count = counts.get(o.id) ?? 0
        // Deleted options only while they have answers.
        if (o.deleted && count === 0) continue
        options.push({ id: o.id, label: o.label, count, pct: pct(count, answered), ...(o.deleted && { deleted: true }), ...(o.id === OTHER_OPTION_ID && { other: true }) })
      }
      // Answers whose option is in no version (shouldn't happen): keep them countable.
      for (const [id, count] of counts) {
        if (!options.some((o) => o.id === id)) {
          options.push({ id, label: id === OTHER_OPTION_ID ? 'Other' : `${id} (deleted option)`, count, pct: pct(count, answered), deleted: id !== OTHER_OPTION_ID, ...(id === OTHER_OPTION_ID && { other: true }) })
        }
      }
      const other = others
        .map((r) => ({ responseId: r.id, submittedAt: r.submitted_at.toISOString(), text: otherText(r.val) }))
        .filter((r) => r.text !== '')
      return { kind: 'choice', options, other }
    }
    case 'country': {
      const options = [...counts]
        .map(([id, count]) => ({ id, label: countryName(id), count, pct: pct(count, answered) }))
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
      return { kind: 'choice', options, other: [] }
    }
    case 'rating': {
      const scale = (e.display.props as { scale?: number }).scale ?? 5
      const distribution = Array.from({ length: scale }, (_, i) => ({ value: i + 1, count: counts.get(String(i + 1)) ?? 0 }))
      const total = distribution.reduce((s, d) => s + d.count, 0)
      const satisfied = distribution.filter((d) => d.value >= 4).reduce((s, d) => s + d.count, 0)
      return {
        kind: 'rating',
        scale,
        average: numbers?.avg == null ? null : round1(Number(numbers.avg)),
        distribution,
        // CSAT: share of 4 and 5 on a 5-point scale.
        csat: scale === 5 && total > 0 ? round1((satisfied / total) * 100) : null,
      }
    }
    case 'nps': {
      const distribution = Array.from({ length: 11 }, (_, i) => ({ value: i, count: counts.get(String(i)) ?? 0 }))
      const sum = (lo: number, hi: number) => distribution.filter((d) => d.value >= lo && d.value <= hi).reduce((s, d) => s + d.count, 0)
      const detractors = sum(0, 6)
      const passives = sum(7, 8)
      const promoters = sum(9, 10)
      const total = detractors + passives + promoters
      // Same rounding as the dashboard's npsScore (Math.round), so card and score agree.
      const score = total > 0 ? Math.round(((promoters - detractors) / total) * 100) : null
      return { kind: 'nps', score, detractors, passives, promoters, distribution }
    }
    case 'number':
      return {
        kind: 'number',
        average: numbers?.avg == null ? null : round1(Number(numbers.avg)),
        min: num(numbers?.min),
        max: num(numbers?.max),
        median: numbers?.median == null ? null : round1(Number(numbers.median)),
      }
    case 'signature':
      return { kind: 'count', count: answered, noun: 'signed' }
    case 'consent':
      return { kind: 'count', count: answered, noun: 'accepted' }
    default:
      return { kind: 'latest', items: latestItems(e, latest) }
  }
}
