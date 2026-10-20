import type { JSONValue } from 'postgres'
import { formDefinition, type FormDefinition } from '../../shared/form/definition'
import type { Queryable } from '../db/client'
import { buildSearchText } from './format'

/**
 * Test and benchmark fixtures: a form covering every summary card, and deterministic fake
 * answers. Used by responses.int.test.ts, the e2e seed and bench.ts (10k rows). Not imported by
 * the app.
 */

export const F = {
  name: 'f_name0001',
  email: 'f_email001',
  plan: 'f_plan0001', // single choice with Other
  topics: 'f_topics01', // multiple choice with Other
  size: 'f_size0001', // dropdown
  recommend: 'f_yesno001',
  country: 'f_country1',
  stars: 'f_rating01',
  nps: 'f_nps00001',
  seats: 'f_number01',
  company: 'f_short001',
  feedback: 'f_long0001',
  start: 'f_date0001',
  call: 'f_time0001',
  signature: 'f_sign0001',
  terms: 'f_terms001',
  address: 'f_addr0001',
} as const

export const O = {
  starter: 'o_start1',
  pro: 'o_pro001',
  team: 'o_team01',
  api: 'o_api001',
  forms: 'o_forms1',
  reports: 'o_rep001',
  small: 'o_small1',
  medium: 'o_med001',
  large: 'o_large1',
} as const

export function benchDefinition(): FormDefinition {
  return formDefinition.parse({
    layout: 'all_at_once',
    startScreen: { enabled: false },
    endScreen: { title: 'Thanks!' },
    fields: [
      { id: F.name, type: 'name', label: 'Your name', props: { split: true } },
      { id: F.email, type: 'email', label: 'Work email' },
      { id: 'f_sect0001', type: 'section_break', label: 'About you' },
      {
        id: F.plan,
        type: 'single_choice',
        label: 'Which plan are you on?',
        props: { other: true, options: [{ id: O.starter, label: 'Starter' }, { id: O.pro, label: 'Pro' }, { id: O.team, label: 'Team' }] },
      },
      {
        id: F.topics,
        type: 'multiple_choice',
        label: 'What do you use us for?',
        props: { other: true, options: [{ id: O.api, label: 'API' }, { id: O.forms, label: 'Forms' }, { id: O.reports, label: 'Reports' }] },
      },
      {
        id: F.size,
        type: 'dropdown',
        label: 'Company size',
        props: { options: [{ id: O.small, label: '1–10' }, { id: O.medium, label: '11–200' }, { id: O.large, label: '200+' }] },
      },
      { id: F.recommend, type: 'yes_no', label: 'Would you buy again?' },
      { id: F.country, type: 'country', label: 'Country' },
      { id: F.stars, type: 'rating', label: 'Rate the onboarding', props: { scale: 5 } },
      { id: F.nps, type: 'nps', label: 'How likely are you to recommend us?' },
      { id: F.seats, type: 'number', label: 'How many seats?' },
      { id: F.company, type: 'short_text', label: 'Company' },
      { id: F.feedback, type: 'long_text', label: 'Anything else?' },
      { id: F.start, type: 'date', label: 'Start date', props: { format: 'YYYY-MM-DD' } },
      { id: F.call, type: 'time', label: 'Best time to call' },
      { id: F.signature, type: 'signature', label: 'Sign here' },
      { id: F.terms, type: 'consent', label: 'Terms' },
      { id: F.address, type: 'address', label: 'Billing address' },
    ],
  })
}

/** Small deterministic PRNG (mulberry32). */
export function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const FIRST = ['Ada', 'Grace', 'Alan', 'Linus', 'Margaret', 'Ken', 'Barbara', 'Dennis', 'Frances', 'Edsger']
const LAST = ['Lovelace', 'Hopper', 'Turing', 'Torvalds', 'Hamilton', 'Thompson', 'Liskov', 'Ritchie', 'Allen', 'Dijkstra']
const COMPANIES = ['Acme', 'Globex', 'Initech', 'Umbrella', 'Hooli', 'Stark', 'Wayne', 'Wonka']
const COUNTRIES = ['US', 'GB', 'DE', 'FR', 'IN', 'BR', 'JP', 'CA']

export function fakeAnswers(i: number): { answers: Record<string, unknown>; ttc: Record<string, number> } {
  const r = rng(i + 1)
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)]
  const a: Record<string, unknown> = {}
  const first = pick(FIRST)
  const last = pick(LAST)
  a[F.name] = { first, last }
  a[F.email] = `${first}.${last}${i}@example.com`.toLowerCase()
  a[F.plan] = r() < 0.08 ? { option: 'o_other', other: pick(['Enterprise', 'Nonprofit', 'Trial']) } : { option: pick([O.starter, O.pro, O.team]) }
  const topics: { option: string; other?: string }[] = [O.api, O.forms, O.reports].filter(() => r() < 0.5).map((option) => ({ option }))
  if (r() < 0.05) topics.push({ option: 'o_other', other: 'Surveys' })
  if (topics.length) a[F.topics] = topics
  if (r() < 0.9) a[F.size] = { option: pick([O.small, O.medium, O.large]) }
  a[F.recommend] = r() < 0.7
  a[F.country] = pick(COUNTRIES)
  a[F.stars] = 1 + Math.floor(r() * 5)
  a[F.nps] = Math.floor(r() * 11)
  if (r() < 0.8) a[F.seats] = 1 + Math.floor(r() * 500)
  a[F.company] = pick(COMPANIES)
  if (r() < 0.4) a[F.feedback] = `Feedback number ${i}: ${pick(['love it', 'needs work', 'great support', 'too pricey'])}`
  a[F.start] = `2026-${String(1 + Math.floor(r() * 12)).padStart(2, '0')}-${String(1 + Math.floor(r() * 28)).padStart(2, '0')}`
  a[F.call] = `${String(8 + Math.floor(r() * 10)).padStart(2, '0')}:${pick(['00', '15', '30', '45'])}`
  if (r() < 0.5) a[F.signature] = { url: `https://cdn.example.com/sig/${i}.png` }
  a[F.terms] = { accepted: true, at: '2026-10-01T10:00:00.000Z', text: 'I agree to the terms and privacy policy', version: 1 }
  if (r() < 0.6) a[F.address] = { street: `${i} Main St`, city: pick(['Springfield', 'Shelbyville']), country: 'US' }
  const ttc: Record<string, number> = {}
  for (const id of Object.keys(a)) ttc[id] = 1000 + Math.floor(r() * 9000)
  return { answers: a, ttc }
}

export interface SeededForm {
  id: string
  versionId: string
  slug: string
}

/** Inserts a live form with one published version of `def`. */
export async function insertBenchForm(sql: Queryable, def: FormDefinition = benchDefinition(), title = 'Customer survey'): Promise<SeededForm> {
  const slug = `bench-${Math.random().toString(36).slice(2, 10)}`
  const [form] = await sql<{ id: string }[]>`
    INSERT INTO forms (slug, title, status, draft) VALUES (${slug}, ${title}, 'live', ${sql.json(def as unknown as JSONValue)}) RETURNING id
  `
  const [v] = await sql<{ id: string }[]>`
    INSERT INTO form_versions (form_id, version, definition, theme) VALUES (${form.id}, 1, ${sql.json(def as unknown as JSONValue)}, '{}'::jsonb) RETURNING id
  `
  await sql`UPDATE forms SET published_version_id = ${v.id} WHERE id = ${form.id}`
  return { id: form.id, versionId: v.id, slug }
}

/**
 * Inserts `n` fake responses spread over the last `days` days (newest first), in batches,
 * and syncs forms.response_count. Returns the ids in insertion order.
 */
export async function insertFakeResponses(
  sql: Queryable,
  form: SeededForm,
  n: number,
  opts: { days?: number; offset?: number; def?: FormDefinition; now?: Date } = {},
): Promise<void> {
  const def = opts.def ?? benchDefinition()
  const days = opts.days ?? 90
  const now = (opts.now ?? new Date()).getTime()
  const BATCH = 1000
  for (let start = 0; start < n; start += BATCH) {
    const rows = []
    for (let i = start; i < Math.min(n, start + BATCH); i++) {
      const k = i + (opts.offset ?? 0)
      const { answers, ttc } = fakeAnswers(k)
      const r = rng(k * 7 + 3)
      const submitted = new Date(now - Math.floor(r() * days * 86_400_000))
      const duration = 20_000 + Math.floor(r() * 400_000)
      rows.push({
        form_id: form.id,
        form_version_id: form.versionId,
        answers: answers as JSONValue,
        ttc: ttc as JSONValue,
        search_text: buildSearchText(def.fields, answers),
        started_at: new Date(submitted.getTime() - duration),
        submitted_at: submitted,
        duration_ms: duration,
        device: r() < 0.6 ? 'desktop' : 'mobile',
        browser: r() < 0.5 ? 'Chrome' : 'Safari',
        country: 'US',
      })
    }
    await sql`
      INSERT INTO responses ${sql(rows.map((x) => ({ ...x, answers: sql.json(x.answers), ttc: sql.json(x.ttc) })) as never)}
    `
  }
  await sql`
    UPDATE forms SET response_count = (SELECT count(*) FROM responses WHERE form_id = ${form.id}),
      last_response_at = (SELECT max(submitted_at) FROM responses WHERE form_id = ${form.id})
    WHERE id = ${form.id}
  `
}

/** Funnel rollup rows: `views` and `starts` in one 15-minute bucket today. */
export async function insertFunnel(sql: Queryable, formId: string, views: number, starts: number, at = new Date()): Promise<void> {
  await sql`
    INSERT INTO form_event_counts (form_id, bucket, views, starts)
    VALUES (${formId}, date_bin('15 minutes', ${at}::timestamptz, '2000-01-01'), ${views}, ${starts})
    ON CONFLICT (form_id, bucket) DO UPDATE SET views = form_event_counts.views + EXCLUDED.views, starts = form_event_counts.starts + EXCLUDED.starts
  `
}
