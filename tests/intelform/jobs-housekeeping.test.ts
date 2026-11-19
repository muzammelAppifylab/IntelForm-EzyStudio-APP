import { describe, expect, it, vi } from 'vitest'
import {
  EVENTS_BATCH,
  EVENTS_KEEP_DAYS,
  FOLD_BATCH,
  foldEventCounts,
  foldResponseHours,
  runSteps,
  sweepFormEvents,
  sweepLoop,
  sweepResponseHourRows,
} from '../../src/server/intelform/housekeeping'
import { doneSet, isDone, markAllDone, markDone, sweepDoneMarkers, sweepRateLimits, SWEEP_BATCH } from '../../src/server/intelform/notify/markers'
import { trimWebhookDeliveries } from '../../src/server/intelform/webhooks/deliver'

const text = (call: unknown[]) => (call[0] as TemplateStringsArray).join('?')

/** A clock that moves `step` ms each time it is read. */
const ticking = (step: number) => {
  let t = 0
  return () => (t += step)
}

describe('sweepLoop', () => {
  it('runs statements until one comes back short', async () => {
    const counts = [5, 5, 2]
    const stmt = vi.fn(async () => counts.shift() ?? 0)
    expect(await sweepLoop(stmt, 5, { budgetMs: 10_000 })).toEqual({ rows: 12, more: false })
    expect(stmt).toHaveBeenCalledTimes(3)
  })

  it('stops on the budget with more, and always runs one statement', async () => {
    const stmt = vi.fn(async () => 5)
    expect(await sweepLoop(stmt, 5, { budgetMs: 2_500, now: ticking(1_000) })).toEqual({ rows: 15, more: true })
    const once = vi.fn(async () => 5)
    expect(await sweepLoop(once, 5, { budgetMs: 0 })).toEqual({ rows: 5, more: true })
    expect(once).toHaveBeenCalledTimes(1)
  })
})

describe('runSteps', () => {
  it('gives each step min(cap, time left), quick steps always run, leftover time goes to the steps with more', async () => {
    let t = 0
    const now = () => t
    const calls: [string, number][] = []
    const step = (name: string, capMs: number, spend: number, more = false) => ({
      name,
      capMs,
      run: async (budget: number) => {
        calls.push([name, budget])
        t += Math.min(spend, budget || spend)
        return capMs === 0 ? 1 : { rows: 1, more }
      },
    })
    const out = await runSteps(
      [step('quick', 0, 100), step('slow', 10_000, 10_000, true), step('fast', 10_000, 1_000), step('starved', 10_000, 10_000)],
      { totalMs: 25_000, now },
    )
    expect(calls.slice(0, 4)).toEqual([
      ['quick', 0],
      ['slow', 10_000],
      ['fast', 10_000],
      // 25,000 − 100 − 10,000 − 1,000 left.
      ['starved', 10_000],
    ])
    // Second pass: what is left (3,900 ms) goes to the step that still had work.
    expect(calls[4]).toEqual(['slow', 3_900])
    expect(out.counts).toEqual({ quick: 1, slow: 2, fast: 1, starved: 1 })
    expect(out.more).toEqual(['slow'])
  })

  it('skips budgeted steps once time is out (they report more), and a throwing step does not stop the rest', async () => {
    let t = 0
    const log = vi.fn()
    const out = await runSteps(
      [
        { name: 'boom', capMs: 1_000, run: async () => { throw new TypeError('x') } },
        { name: 'hog', capMs: 10_000, run: async () => { t += 10_000; return { rows: 3, more: false } } },
        { name: 'late', capMs: 1_000, run: async () => ({ rows: 9, more: false }) },
        { name: 'quick', capMs: 0, run: async () => 4 },
      ],
      { totalMs: 10_000, now: () => t, log },
    )
    expect(out.failed).toEqual(['boom'])
    expect(log).toHaveBeenCalledWith('[intelform] boom failed (TypeError)')
    expect(out.counts).toEqual({ boom: 0, hog: 3, late: 0, quick: 4 })
    expect(out.more).toEqual(['late'])
  })
})

describe('sweeps: one bounded statement on an index range, deleted by ctid', () => {
  const exec = (n: number) => ({ $executeRaw: vi.fn(async () => n) })

  it('raw form events: older than the keep, oldest first', async () => {
    const db = exec(3)
    expect(await sweepFormEvents(db as never, { budgetMs: 1_000 })).toEqual({ rows: 3, more: false })
    const sql = text(db.$executeRaw.mock.calls[0]!)
    expect(sql).toContain('DELETE FROM form_events WHERE ctid = ANY(ARRAY(')
    expect(sql).toContain('WHERE created_at < now() - make_interval(days =>')
    expect(sql).toContain('ORDER BY created_at')
    expect(db.$executeRaw.mock.calls[0]!.slice(1)).toEqual([EVENTS_KEEP_DAYS, EVENTS_BATCH])
    expect(EVENTS_KEEP_DAYS).toBeLessThanOrEqual(2)
  })

  it('rate-limit windows: on the window-end index, a minute after they end', async () => {
    const db = exec(SWEEP_BATCH)
    const out = await sweepRateLimits(db as never, { budgetMs: 1_500, now: ticking(1_000) })
    expect(out.more).toBe(true)
    const sql = text(db.$executeRaw.mock.calls[0]!)
    expect(sql).toContain("WHERE intelform_window_end(window_start, window_seconds) < now() - interval '1 minute'")
    expect(sql).toContain('ORDER BY intelform_window_end(window_start, window_seconds)')
    // Never the old filter that stepped over live rows.
    expect(sql).not.toContain('window_start < now()')
  })

  it('done-markers: on expires_at', async () => {
    const db = exec(0)
    await sweepDoneMarkers(db as never, { budgetMs: 1_000 })
    expect(text(db.$executeRaw.mock.calls[0]!)).toContain('FROM intelform_done_markers WHERE expires_at < now() ORDER BY expires_at')
  })

  it('hourly counts: older than 35 days on the hour index', async () => {
    const db = exec(0)
    await sweepResponseHourRows(db as never, { budgetMs: 1_000 })
    expect(text(db.$executeRaw.mock.calls[0]!)).toContain('ORDER BY hour')
  })
})

describe('shard folds', () => {
  for (const [name, fold, table] of [
    ['hourly counts', foldResponseHours, 'form_response_hours'],
    ['funnel rollup', foldEventCounts, 'form_event_counts'],
  ] as const) {
    it(`${name}: deletes shards 1–15 and adds them to shard 0 in ONE statement, only in the fold window`, async () => {
      const results = [
        { sampled: FOLD_BATCH, folded: 900 },
        { sampled: 3, folded: 3 },
      ]
      const db = { $queryRaw: vi.fn(async () => [results.shift()]) }
      expect(await fold(db as never, { budgetMs: 10_000 })).toEqual({ rows: 903, more: false })
      const sql = text(db.$queryRaw.mock.calls[0]!)
      expect(sql).toContain(`DELETE FROM ${table}`)
      expect(sql).toContain('shard <> 0')
      expect(sql).toContain(`INSERT INTO ${table} AS t`)
      expect(sql).toContain('SELECT form_id, ')
      expect(sql).toMatch(/, 0, sum\(/)
      expect(sql).toMatch(/>= now\(\) - \?::interval AND \w+ < now\(\) - \?::interval/)
      expect(db.$queryRaw.mock.calls[0]!.slice(1, 3)).toEqual(['3 days', '2 days'])
    })
  }
})

describe('done-markers', () => {
  it('read both the new table and (for a week) the old one, in ONE query', async () => {
    const db = { $queryRaw: vi.fn(async () => [{ key: 'job:a:1' }]) }
    expect(await doneSet(db as never, ['job:a:1', 'job:b:1'])).toEqual(new Set(['job:a:1']))
    const sql = text(db.$queryRaw.mock.calls[0]!)
    expect(sql).toContain('FROM intelform_done_markers WHERE key = ANY(')
    expect(sql).toContain('expires_at > now()')
    expect(sql).toContain('SELECT DISTINCT key FROM intelform_rate_limits')
    expect(await isDone(db as never, 'job:a:1')).toBe(true)
    expect(await doneSet(db as never, [])).toEqual(new Set())
    expect(db.$queryRaw).toHaveBeenCalledTimes(2)
  })

  it('write only to intelform_done_markers, the key first (markDone) and all keys in one statement (markAllDone)', async () => {
    const db = { $executeRaw: vi.fn(async () => 1) }
    await markDone(db as never, 'job:x:1')
    await markAllDone(db as never, ['job:y:1', 'job:y:2'])
    await markAllDone(db as never, [])
    expect(db.$executeRaw).toHaveBeenCalledTimes(2)
    for (const call of db.$executeRaw.mock.calls) {
      expect(text(call)).toContain('INSERT INTO intelform_done_markers (key, expires_at)')
      expect(text(call)).not.toContain('intelform_rate_limits')
    }
    expect((db.$executeRaw.mock.calls[0] as unknown[])[1]).toBe('job:x:1')
  })
})

describe('trimWebhookDeliveries', () => {
  const FORMS = Array.from({ length: 120 }, (_, i) => ({ form_id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}` }))

  it('trims by age on created_at, then per recent form in chunks of 50 (a full chunk runs again), never a window over the table', async () => {
    const ages = [5000, 7]
    const perForm = [
      { deleted: 2000, full: true },
      { deleted: 10, full: false },
      { deleted: 0, full: false },
      { deleted: 4, full: false },
    ]
    const db = {
      $executeRaw: vi.fn(async () => ages.shift() ?? 0),
      $queryRaw: vi.fn(async (s: TemplateStringsArray) => (s.join('?').includes('SELECT DISTINCT form_id') ? FORMS : [perForm.shift()])),
    }
    expect(await trimWebhookDeliveries(db as never, { budgetMs: 10_000 })).toEqual({ rows: 5007 + 2014, more: false })
    const age = text(db.$executeRaw.mock.calls[0]!)
    expect(age).toContain('WHERE created_at < now() - make_interval(days =>')
    // Recent forms, then 4 chunk statements: the first one twice (it was full), then 2 more.
    expect(db.$queryRaw).toHaveBeenCalledTimes(5)
    const chunks = db.$queryRaw.mock.calls.slice(1).map((c) => ((c as unknown[])[1] as string[]).length)
    expect(chunks).toEqual([50, 50, 50, 20])
    const sql = text(db.$queryRaw.mock.calls[1]!)
    expect(sql).toContain('ORDER BY w.created_at DESC, w.id DESC')
    expect(sql).toContain('OFFSET ? LIMIT ?')
    expect(sql).not.toContain('row_number()')
  })

  it('stops on the budget with more', async () => {
    const db = {
      $executeRaw: vi.fn(async () => 5000),
      $queryRaw: vi.fn(async () => []),
    }
    expect(await trimWebhookDeliveries(db as never, { budgetMs: 2_500, now: ticking(1_000) })).toEqual({ rows: 15_000, more: true })
    expect(db.$queryRaw).not.toHaveBeenCalled()
  })
})
