import { performance } from 'node:perf_hooks'
import { responsesCsvQuery, responsesListQuery, summaryQuery } from '../../shared/api-responses'
import { sql } from '../db/client'
import { formCsvChunks } from './csv'
import { benchDefinition, F, insertBenchForm, insertFakeResponses, insertFunnel, O } from './fixtures'
import { formSummary } from './summary'
import { listResponses } from './table'

/**
 * Seeds a 10k-response form and times the summary, table pages and CSV export.
 *   DATABASE_URL=postgres://intelform:intelform@localhost:5433/intelform_g npx tsx server/responses/bench.ts [count]
 * Prints warm medians of 5 runs (first run reported separately as "cold").
 */
const N = Number(process.argv[2] ?? 10_000)

async function time<T>(label: string, fn: () => Promise<T>, runs = 5): Promise<T> {
  const ts: number[] = []
  let out!: T
  for (let i = 0; i <= runs; i++) {
    const t0 = performance.now()
    out = await fn()
    ts.push(performance.now() - t0)
  }
  const [cold, ...warm] = ts
  warm.sort((a, b) => a - b)
  console.log(`${label.padEnd(44)} cold ${cold.toFixed(0).padStart(5)} ms   warm median ${warm[Math.floor(warm.length / 2)].toFixed(1).padStart(7)} ms`)
  return out
}

const t0 = performance.now()
const form = await insertBenchForm(sql, benchDefinition(), `Bench ${N}`)
await insertFakeResponses(sql, form, N, { days: 90 })
await insertFunnel(sql, form.id, Math.round(N * 2.4), Math.round(N * 1.3))
await sql`ANALYZE responses`
console.log(`seeded ${N} responses into form ${form.id} in ${((performance.now() - t0) / 1000).toFixed(1)} s`)

const list = (q: Record<string, unknown>) => listResponses(form.id, responsesListQuery.parse(q))
const s = await time('summary, all time', () => formSummary(form.id, summaryQuery.parse({ range: 'all', tz: 'Europe/London' })))
console.log(`  responses=${s.totals.responses} questions=${s.questions.length} series days=${s.series.length}`)
await time('summary, 30 days', () => formSummary(form.id, summaryQuery.parse({ range: '30d', tz: 'Asia/Kolkata' })))
await time('table page 1 (default sort)', () => list({}))
const last = Math.ceil(N / 50)
await time(`table page ${last} (last)`, () => list({ page: last }))
await time('table sort by number field, page 1', () => list({ sort: F.seats, dir: 'asc' }))
await time('table sort by choice field, last page', () => list({ sort: F.plan, page: last }))
await time('table search "hopper", page 1 + count', () => list({ q: 'hopper' }))
await time('table choice filter (plan = Pro)', () => list({ filter: [`${F.plan}:${O.pro}`] }))
await time(`CSV of all ${N}`, async () => {
  let bytes = 0
  for await (const chunk of formCsvChunks(form.id, responsesCsvQuery.parse({}))) bytes += chunk.length
  return bytes
}, 2)
await sql.end({ timeout: 5 })
