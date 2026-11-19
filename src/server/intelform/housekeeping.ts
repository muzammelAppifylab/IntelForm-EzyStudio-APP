import type { PrismaClient } from '../../platform/db'

/**
 * Bounded clean-ups for the background jobs (src/server/background.ts). Every sweep:
 *
 *   - deletes by an INDEX RANGE (an expiry, created_at, hour, bucket), never a filter that steps
 *     over live rows, and by ctid from a LIMITed subquery (a TID scan: no join on the big table);
 *   - runs one short statement per batch, in a loop, until a batch comes back short or its time
 *     budget is spent, and says whether there is `more`;
 *   - is safe to run twice or at the same time as another run (each statement stands alone).
 *
 * The budgets come from `runSteps`, which gives every step of a job its own share of the 60 s a
 * run has, so one slow step never starves the others.
 */

export interface SweepResult {
  /** Rows deleted (or folded). */
  rows: number
  /** Stopped on the budget with work left. */
  more: boolean
}

export interface BudgetOptions {
  budgetMs: number
  /** Rows per statement. */
  batch?: number
  /** Tests: the clock. */
  now?: () => number
}

/**
 * Runs `statement` (one bounded statement that returns how many rows it handled, at most `batch`)
 * until it handles fewer than `batch` or the budget is spent. At least one statement always runs.
 */
export async function sweepLoop(statement: () => Promise<number>, batch: number, opts: { budgetMs: number; now?: () => number }): Promise<SweepResult> {
  const now = opts.now ?? Date.now
  const until = now() + Math.max(0, opts.budgetMs)
  let rows = 0
  for (;;) {
    const n = Number(await statement())
    rows += n
    if (n < batch) return { rows, more: false }
    if (now() >= until) return { rows, more: true }
  }
}

// ---------------------------------------------------------------------------
// The step runner
// ---------------------------------------------------------------------------

export interface Step {
  name: string
  /** Most this step gets in the first pass. 0 = one quick statement, no budget. */
  capMs: number
  run: (budgetMs: number) => Promise<number | SweepResult>
}

export interface StepsResult {
  counts: Record<string, number>
  /** Steps that stopped with work left (the next run goes on). */
  more: string[]
  /** Steps that threw (logged by name; the others still ran). */
  failed: string[]
}

/** Below this, a budgeted step isn't started (a statement or two could outlast the run). */
const MIN_STEP_MS = 500

/**
 * Runs `steps` in order, each with min(its cap, what's left of `totalMs`), each in its own
 * try/catch. Then a second pass shares whatever time is left between the steps that said `more`.
 * A step that throws is logged (its name only) and the next one runs.
 */
export async function runSteps(steps: readonly Step[], opts: { totalMs: number; now?: () => number; log?: (msg: string) => void }): Promise<StepsResult> {
  const now = opts.now ?? Date.now
  const log = opts.log ?? ((msg: string) => console.error(msg))
  const until = now() + opts.totalMs
  const out: StepsResult = { counts: {}, more: [], failed: [] }
  const pending = new Set<string>()

  const runOne = async (step: Step, budgetMs: number): Promise<void> => {
    try {
      const r = await step.run(budgetMs)
      const rows = typeof r === 'number' ? r : r.rows
      out.counts[step.name] = (out.counts[step.name] ?? 0) + Number(rows)
      if (typeof r === 'object' && r.more) pending.add(step.name)
      else pending.delete(step.name)
    } catch (err) {
      pending.delete(step.name)
      if (!out.failed.includes(step.name)) out.failed.push(step.name)
      log(`[intelform] ${step.name} failed (${err instanceof Error ? err.name : 'error'})`)
    }
  }

  for (const step of steps) {
    out.counts[step.name] ??= 0
    const left = until - now()
    if (step.capMs === 0) {
      // Quick single statements run whatever the clock says (they keep the stored state right).
      await runOne(step, 0)
      continue
    }
    if (left < MIN_STEP_MS) {
      pending.add(step.name)
      continue
    }
    await runOne(step, Math.min(step.capMs, left))
  }

  // Second pass: the time the quick steps left, shared by the steps with work left.
  for (const step of steps) {
    if (!pending.has(step.name)) continue
    const waiting = steps.filter((s) => pending.has(s.name)).length
    const left = until - now()
    if (left < MIN_STEP_MS) break
    await runOne(step, Math.floor(left / Math.max(1, waiting)))
  }
  out.more = steps.filter((s) => pending.has(s.name)).map((s) => s.name)
  return out
}

// ---------------------------------------------------------------------------
// Raw funnel events
// ---------------------------------------------------------------------------

/**
 * Raw view/start events only dedupe a browser session (form_id, type, session_token); the counts
 * live in form_event_counts and form_counts. Two days covers any real session.
 */
export const EVENTS_KEEP_DAYS = 2
export const EVENTS_BATCH = 10_000

/** Deletes raw form_events older than EVENTS_KEEP_DAYS, oldest first, on the created_at index. */
export async function sweepFormEvents(db: Pick<PrismaClient, '$executeRaw'>, opts: BudgetOptions): Promise<SweepResult> {
  const batch = opts.batch ?? EVENTS_BATCH
  return sweepLoop(
    () => db.$executeRaw`
      DELETE FROM form_events WHERE ctid = ANY(ARRAY(
        SELECT ctid FROM form_events
        WHERE created_at < now() - make_interval(days => ${EVENTS_KEEP_DAYS}::int)
        ORDER BY created_at
        LIMIT ${batch}
      ))
    `,
    batch,
    opts,
  )
}

// ---------------------------------------------------------------------------
// Hourly response counts and the 15-minute funnel rollup: fold old shards, sweep old hours
// ---------------------------------------------------------------------------

/** Hourly counts are kept this long (the strip reads 14 days, "this week" 7). */
export const RESPONSE_HOURS_KEEP_DAYS = 35
export const HOURS_BATCH = 10_000
/**
 * Shards of an hour / bucket older than FOLD_AFTER and younger than FOLD_UNTIL are folded into
 * shard 0. Only new responses and beacons write a random shard, and they write the current hour or
 * bucket, so nothing else writes shards 1–15 that old (deletes write shard 0, under row locks). The
 * window is a day wide, so an hourly job that missed some runs still folds everything; it starts
 * at the window's edge, so the scan never steps over months of folded rows.
 */
export const FOLD_AFTER = '2 days'
export const FOLD_UNTIL = '3 days'
/** Shard rows sampled per fold statement (each sampled key folds all its shards: ≤ 15 rows each). */
export const FOLD_BATCH = 1000

/** Deletes form_response_hours rows older than RESPONSE_HOURS_KEEP_DAYS, on the hour index. */
export async function sweepResponseHourRows(db: Pick<PrismaClient, '$executeRaw'>, opts: BudgetOptions): Promise<SweepResult> {
  const batch = opts.batch ?? HOURS_BATCH
  return sweepLoop(
    () => db.$executeRaw`
      DELETE FROM form_response_hours WHERE ctid = ANY(ARRAY(
        SELECT ctid FROM form_response_hours
        WHERE hour < now() - make_interval(days => ${RESPONSE_HOURS_KEEP_DAYS}::int)
        ORDER BY hour
        LIMIT ${batch}
      ))
    `,
    batch,
    opts,
  )
}

/**
 * Folds shards 1–15 of hours in the fold window into shard 0, in ONE statement per batch (the
 * sums stay exact: the deleted rows' n is added to shard 0 in the same statement). Returns the
 * shard rows folded.
 */
export async function foldResponseHours(db: Pick<PrismaClient, '$queryRaw'>, opts: BudgetOptions): Promise<SweepResult> {
  const batch = opts.batch ?? FOLD_BATCH
  let rows = 0
  const loop = await sweepLoop(
    async () => {
      const [r] = await db.$queryRaw<{ sampled: number; folded: number }[]>`
        WITH sample AS (
          SELECT form_id, hour FROM form_response_hours
          WHERE hour >= now() - ${FOLD_UNTIL}::interval AND hour < now() - ${FOLD_AFTER}::interval AND shard <> 0
          LIMIT ${batch}
        ),
        k AS (SELECT DISTINCT form_id, hour FROM sample),
        gone AS (
          DELETE FROM form_response_hours h USING k
          WHERE h.form_id = k.form_id AND h.hour = k.hour AND h.shard <> 0
          RETURNING h.form_id, h.hour, h.n
        ),
        folded AS (
          INSERT INTO form_response_hours AS t (form_id, hour, shard, n)
          SELECT form_id, hour, 0, sum(n)::int FROM gone GROUP BY 1, 2
          ON CONFLICT (form_id, hour, shard) DO UPDATE SET n = t.n + EXCLUDED.n
          RETURNING 1
        )
        SELECT (SELECT count(*) FROM sample)::int AS sampled, (SELECT count(*) FROM gone)::int AS folded
      `
      rows += Number(r?.folded ?? 0)
      return Number(r?.sampled ?? 0)
    },
    batch,
    opts,
  )
  return { rows, more: loop.more }
}

/**
 * The same fold for form_event_counts (views and starts per 15-minute bucket), on its bucket
 * index. Readers sum every shard of a bucket range, so their totals don't move. Buckets are never
 * merged across time: a day starts at a different bucket in every time zone.
 */
export async function foldEventCounts(db: Pick<PrismaClient, '$queryRaw'>, opts: BudgetOptions): Promise<SweepResult> {
  const batch = opts.batch ?? FOLD_BATCH
  let rows = 0
  const loop = await sweepLoop(
    async () => {
      const [r] = await db.$queryRaw<{ sampled: number; folded: number }[]>`
        WITH sample AS (
          SELECT form_id, bucket FROM form_event_counts
          WHERE bucket >= now() - ${FOLD_UNTIL}::interval AND bucket < now() - ${FOLD_AFTER}::interval AND shard <> 0
          LIMIT ${batch}
        ),
        k AS (SELECT DISTINCT form_id, bucket FROM sample),
        gone AS (
          DELETE FROM form_event_counts c USING k
          WHERE c.form_id = k.form_id AND c.bucket = k.bucket AND c.shard <> 0
          RETURNING c.form_id, c.bucket, c.views, c.starts
        ),
        folded AS (
          INSERT INTO form_event_counts AS t (form_id, bucket, shard, views, starts)
          SELECT form_id, bucket, 0, sum(views)::int, sum(starts)::int FROM gone GROUP BY 1, 2
          ON CONFLICT (form_id, bucket, shard) DO UPDATE SET views = t.views + EXCLUDED.views, starts = t.starts + EXCLUDED.starts
          RETURNING 1
        )
        SELECT (SELECT count(*) FROM sample)::int AS sampled, (SELECT count(*) FROM gone)::int AS folded
      `
      rows += Number(r?.folded ?? 0)
      return Number(r?.sampled ?? 0)
    },
    batch,
    opts,
  )
  return { rows, more: loop.more }
}

/** Hourly counts: old rows go, then old shards fold (the sweep first: it is what keeps the table bounded). */
export async function sweepResponseHours(db: Pick<PrismaClient, '$executeRaw' | '$queryRaw'>, opts: BudgetOptions): Promise<SweepResult> {
  const now = opts.now ?? Date.now
  const started = now()
  const swept = await sweepResponseHourRows(db, { ...opts, budgetMs: opts.budgetMs / 2 })
  const folded = await foldResponseHours(db, { now: opts.now, budgetMs: Math.max(0, opts.budgetMs - (now() - started)) })
  return { rows: swept.rows + folded.rows, more: swept.more || folded.more }
}
