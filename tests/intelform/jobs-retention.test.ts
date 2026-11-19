import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

// Agent-made modules the jobs call (stubbed: these tests pass every step in as a dependency).
vi.mock('../../src/server/intelform/summary', () => ({ refreshSummaryRollups: vi.fn(async () => ({ rows: 0, more: false })) }))
import {
  applyRetention,
  background,
  hourlyMaintenance,
  MAX_MINUTE_CONTINUATIONS,
  NOTIFY_RUN_BUDGET_MS,
  notifyRun,
  quarterRun,
  RETENTION_BATCH,
  RETENTION_BUDGET_MS,
  RETENTION_MAX_CONTINUATIONS,
  retentionRun,
} from '../../src/server/background'
import { cache } from '../../src/platform/cache'
import { OVERVIEW_KEY } from '../../src/server/intelform/contacts/query'

describe('background lists', () => {
  it('has a handler for every list and schedule in background.json', () => {
    const manifest = JSON.parse(readFileSync(new URL('../../background.json', import.meta.url), 'utf8')) as {
      lists: Record<string, unknown>
      schedules: Record<string, { list?: string }>
    }
    const needed = new Set([...Object.keys(manifest.lists), ...Object.entries(manifest.schedules).map(([n, s]) => s.list ?? n)])
    for (const list of needed) expect(background.handlers[list], list).toBeTypeOf('function')
    expect(Object.keys(background.handlers).sort()).toEqual([
      'intelform-exports',
      'intelform-file-cleanup',
      'intelform-maintenance',
      'intelform-notify',
      'intelform-quarter',
      'intelform-response-notify',
      'intelform-retention',
      'intelform-webhook-deliver',
      'intelform-webhooks',
    ])
  })
})

type Batch = { deleted: number; file_ids: string[] | null }

function fakeDb(retentionDays: number | null, batches: Batch[]) {
  const queue = [...batches]
  const db = {
    intelformSettings: { findUnique: vi.fn(async () => (retentionDays === undefined ? null : { retentionDays })) },
    $queryRaw: vi.fn(async (_s: TemplateStringsArray, ..._v: unknown[]) => {
      const next = queue.shift()
      return next ? [next] : [{ deleted: 0, file_ids: [] }]
    }),
    $executeRaw: vi.fn(async () => 0),
    $transaction: vi.fn(),
  }
  return { db }
}

const batch = (deleted: number): Batch => ({ deleted, file_ids: null })

describe('applyRetention', () => {
  it('keeps everything when no retention period is set (raw events are the hourly job’s)', async () => {
    const { db } = fakeDb(null, [])
    const out = await applyRetention(db as never)
    expect(out).toEqual({ responses: 0, more: false })
    expect(db.$queryRaw).not.toHaveBeenCalled()
    expect(db.$executeRaw).not.toHaveBeenCalled()
  })

  it('deletes and decrements the counters in one statement per batch (files go to the trash trigger)', async () => {
    const { db } = fakeDb(30, [batch(RETENTION_BATCH), batch(3)])
    const out = await applyRetention(db as never)
    expect(out).toMatchObject({ responses: RETENTION_BATCH + 3, more: false })
    expect(db.$queryRaw).toHaveBeenCalledTimes(2)
    expect(db.$transaction).not.toHaveBeenCalled()
    const text = (db.$queryRaw.mock.calls[0]![0] as TemplateStringsArray).join('?')
    expect(text).not.toContain('UPDATE forms')
    expect(text).toContain('DELETE FROM responses')
    expect(text).toContain('ORDER BY submitted_at')
    expect(text).not.toContain('count(*)::int FROM responses r WHERE r.form_id')
  })

  it('has no batch cap: it keeps deleting full batches until the time budget is spent', async () => {
    const full = Array.from({ length: 100 }, () => batch(RETENTION_BATCH))
    const { db } = fakeDb(7, [...full, batch(1)])
    const out = await applyRetention(db as never)
    expect(out.responses).toBe(RETENTION_BATCH * 100 + 1)
    expect(out.more).toBe(false)
  })

  it('stops starting batches when the time budget is spent and says there is more', async () => {
    let t = 0
    const { db } = fakeDb(7, Array.from({ length: 50 }, () => batch(RETENTION_BATCH)))
    const out = await applyRetention(db as never, { now: () => (t += RETENTION_BUDGET_MS / 4) })
    expect(out.more).toBe(true)
    expect(out.responses).toBeLessThan(RETENTION_BATCH * 50)
  })

  it('clears the cached Summary and contacts strip once responses went (F-029)', async () => {
    const summaryKey = 'report:summary:00000000-0000-4000-8000-000000000001:30d:::UTC'
    await cache.set(summaryKey, { n: 1 }, 300)
    await cache.set(OVERVIEW_KEY, { n: 1 }, 600)
    await applyRetention(fakeDb(30, [batch(0)]).db as never)
    expect(await cache.get(OVERVIEW_KEY)).not.toBeNull()
    await applyRetention(fakeDb(30, [batch(3)]).db as never)
    expect(await cache.get(summaryKey)).toBeNull()
    expect(await cache.get(OVERVIEW_KEY)).toBeNull()
  })
})

describe('retentionRun', () => {
  const T = Date.parse('2026-11-19T10:15:20Z')
  it('sends the next part a minute later, keyed by that minute, while there are more', async () => {
    const send = vi.fn(async () => true)
    const cleanup = vi.fn(async () => undefined)
    const apply = vi.fn(async () => ({ responses: 10, more: true }))
    const out = await retentionRun({} as never, { step: 3 }, { now: () => T, send, cleanup, apply })
    expect(out.continued).toBe(true)
    expect(send).toHaveBeenCalledWith('intelform-retention', { step: 4 }, expect.objectContaining({
      key: 'intelform-retention-2026-11-19T10:16',
      at: new Date(T + 60_000),
    }))
    // Mid-chain: the cleanup job was asked for at the start.
    expect(cleanup).not.toHaveBeenCalled()
  })

  it('asks for the file cleanup at the start and the end of a chain; stops after the cap', async () => {
    const send = vi.fn(async () => true)
    const cleanup = vi.fn(async () => undefined)
    await retentionRun({} as never, {}, { now: () => T, send, cleanup, apply: async () => ({ responses: 5, more: true }) })
    expect(cleanup).toHaveBeenCalledTimes(1)
    await retentionRun({} as never, { step: 7 }, { now: () => T, send, cleanup, apply: async () => ({ responses: 5, more: false }) })
    expect(cleanup).toHaveBeenCalledTimes(2)
    send.mockClear()
    const capped = await retentionRun({} as never, { step: RETENTION_MAX_CONTINUATIONS }, { now: () => T, send, cleanup, apply: async () => ({ responses: 5, more: true }) })
    expect(capped.continued).toBe(false)
    expect(send).not.toHaveBeenCalled()
  })
})

describe('notifyRun (woken by submits, never on a timetable)', () => {
  const T = Date.parse('2026-11-19T10:15:20Z')
  const deps = (more: boolean) => ({
    now: () => T,
    contacts: vi.fn(async () => ({ rows: 0, more: false })),
    sync: vi.fn(async () => 0),
    drain: vi.fn(async () => ({ more }) as never),
    sweep: vi.fn(async () => ({ rows: 0, more: false })),
    send: vi.fn(async () => true),
    nextDue: vi.fn(async () => null as number | null),
    wakeAt: vi.fn(async () => true),
  })

  it('the first run folds contacts, refreshes marked counts, drains, sweeps windows, and sends continuation 1 when the drain has more', async () => {
    const d = deps(true)
    expect(await notifyRun({} as never, {}, d)).toEqual({ k: 0, continued: true, woke: false })
    expect(d.contacts).toHaveBeenCalledTimes(1)
    expect(d.sync).toHaveBeenCalledTimes(1)
    expect(d.sweep).toHaveBeenCalledTimes(1)
    const drainBudget = (d.drain.mock.calls[0] as unknown[])[2] as { budgetMs: number }
    expect(drainBudget.budgetMs).toBe(NOTIFY_RUN_BUDGET_MS - 3_000)
    expect(d.send).toHaveBeenCalledWith('intelform-notify', { k: 1 }, expect.objectContaining({ key: 'notify-2026-11-19T10:15-1' }))
    expect(d.nextDue).not.toHaveBeenCalled()
  })

  it('a failing contacts fold or sync never skips the drain', async () => {
    const d = deps(false)
    d.contacts.mockRejectedValueOnce(new Error('x'))
    d.sync.mockRejectedValueOnce(new Error('y'))
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await notifyRun({} as never, {}, d)).toEqual({ k: 0, continued: false, woke: false })
    expect(d.drain).toHaveBeenCalledTimes(1)
    err.mockRestore()
  })

  it('continuations only drain, and stop at the third', async () => {
    const d = deps(true)
    await notifyRun({} as never, { k: 2 }, d)
    expect(d.contacts).not.toHaveBeenCalled()
    expect(d.sync).not.toHaveBeenCalled()
    expect(d.sweep).not.toHaveBeenCalled()
    expect(d.send).toHaveBeenCalledWith('intelform-notify', { k: 3 }, expect.objectContaining({ key: 'notify-2026-11-19T10:15-3' }))
    d.send.mockClear()
    expect((await notifyRun({} as never, { k: MAX_MINUTE_CONTINUATIONS }, d)).continued).toBe(false)
    expect(d.send).not.toHaveBeenCalled()
  })

  it('a retry waiting for its back-off wakes the job for its minute; an empty queue wakes nothing', async () => {
    const d = deps(false)
    expect((await notifyRun({} as never, {}, d)).woke).toBe(false)
    expect(d.wakeAt).not.toHaveBeenCalled()
    const due = T + 5 * 60_000
    d.nextDue.mockResolvedValueOnce(due)
    expect((await notifyRun({} as never, {}, d)).woke).toBe(true)
    expect(d.wakeAt).toHaveBeenCalledWith(expect.any(String), due, T)
  })

  it('the drain keeps its minimum when the steps before were slow', async () => {
    const d = deps(false)
    let t = T
    d.now = () => t
    d.sync.mockImplementation(async () => {
      t += 45_000
      return 0
    })
    await notifyRun({} as never, null, d)
    expect(((d.drain.mock.calls[0] as unknown[])[2] as { budgetMs: number }).budgetMs).toBe(10_000)
  })
})

describe('quarterRun (every 15 minutes)', () => {
  const todoDb = (todo: Record<string, boolean>) => ({ $queryRaw: vi.fn(async () => [todo]) })
  const deps = () => ({
    contacts: vi.fn(async () => ({ rows: 0, more: false })),
    sync: vi.fn(async () => 0),
    exports: vi.fn(async () => 0),
    rollups: vi.fn(async () => ({ rows: 0, more: false })),
    drain: vi.fn(async () => ({ done: 0, failed: 0, more: false })),
  })

  it('an idle site: ONE statement, and no step runs', async () => {
    const db = todoDb({ contacts: false, counts: false, summary: false, exports: false, notify: false })
    const d = deps()
    await quarterRun(db as never, d)
    expect(db.$queryRaw).toHaveBeenCalledTimes(1)
    for (const step of Object.values(d)) expect(step).not.toHaveBeenCalled()
  })

  it('runs only the steps with work, and one failing step never skips the others', async () => {
    const db = todoDb({ contacts: true, counts: false, summary: true, exports: true, notify: false })
    const d = deps()
    d.exports.mockRejectedValueOnce(new Error('x'))
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    await quarterRun(db as never, d)
    err.mockRestore()
    expect(d.contacts).toHaveBeenCalledTimes(1)
    expect(d.exports).toHaveBeenCalledTimes(1)
    expect(d.rollups).toHaveBeenCalledTimes(1)
    expect(d.sync).not.toHaveBeenCalled()
    expect(d.drain).not.toHaveBeenCalled()
  })
})

describe('hourlyMaintenance', () => {
  function maintenanceDb() {
    return {
      // Every statement deletes 2 rows: under any batch, so every loop stops after one statement.
      $executeRaw: vi.fn(async (_s: TemplateStringsArray, ..._v: unknown[]) => 2),
      $queryRaw: vi.fn(async (s: TemplateStringsArray, ..._v: unknown[]) => {
        const text = s.join('?')
        if (text.includes('sampled')) return [{ sampled: 0, folded: 0 }]
        return [] as unknown[]
      }),
    }
  }
  const drain = vi.fn(async () => ({ removed: 4, failed: 0, more: false }))
  const digests = vi.fn(async () => ({ sent: 1 }))

  it('runs every step once, quick statements first, each budgeted sweep on its index', async () => {
    const db = maintenanceDb()
    expect(await hourlyMaintenance(db as never, { drain, digests })).toEqual({
      closedForms: 2,
      presence: 2,
      staleExports: 0,
      exports: 2,
      digests: 1,
      rateLimits: 2,
      formEvents: 2,
      doneMarkers: 2,
      webhookDeliveries: 2,
      responseHours: 2,
      eventCounts: 0,
      files: 4,
    })
    const sql = db.$executeRaw.mock.calls.map((c) => c[0].join('?'))
    expect(sql[0]).toContain("status = 'closed'")
    expect(sql[1]).toContain('form_presence')
    expect(sql[2]).toContain('intelform_exports')
    expect(sql[3]).toContain('intelform_window_end(window_start, window_seconds) <')
    expect(sql[4]).toContain('FROM form_events')
    expect(sql[5]).toContain('intelform_done_markers')
    expect(sql[6]).toContain('webhook_deliveries')
    expect(sql[7]).toContain('form_response_hours')
    // No window function over the whole delivery log any more.
    expect(sql.join('\n')).not.toContain('row_number()')
    expect(digests).toHaveBeenCalledWith(db, expect.any(String), { budgetMs: 10_000 })
  })

  it('a failing step is logged, the others still run, and the run fails at the end naming it', async () => {
    const db = maintenanceDb()
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const broken = vi.fn(async () => {
      throw new Error('relay down')
    })
    await expect(hourlyMaintenance(db as never, { drain, digests: broken })).rejects.toThrow(/digests/)
    // Every sweep after the digests still ran.
    expect(db.$executeRaw.mock.calls.some((c) => c[0].join('?').includes('form_response_hours'))).toBe(true)
    expect(drain).toHaveBeenCalled()
    err.mockRestore()
  })
})
