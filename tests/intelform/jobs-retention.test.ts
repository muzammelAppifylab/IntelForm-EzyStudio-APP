import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import {
  applyRetention,
  background,
  hourlyMaintenance,
  RETENTION_BATCH,
  RETENTION_MAX_BATCHES,
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
      'intelform-response-notify',
      'intelform-retention',
      'intelform-webhook-deliver',
      'intelform-webhooks',
    ])
  })
})

type Batch = { deleted: number; file_ids: string[] | null }

function fakeDb(retentionDays: number | null, batches: Batch[], events: number[] = [0]) {
  const queue = [...batches]
  const eventQueue = [...events]
  const db = {
    intelformSettings: { findUnique: vi.fn(async () => (retentionDays === undefined ? null : { retentionDays })) },
    $queryRaw: vi.fn(async (_s: TemplateStringsArray, ..._v: unknown[]) => {
      const next = queue.shift()
      return next ? [next] : [{ deleted: 0, file_ids: [] }]
    }),
    $executeRaw: vi.fn(async (s: TemplateStringsArray) => (s.join('').includes('form_events') ? (eventQueue.shift() ?? 0) : 0)),
    $transaction: vi.fn(),
  }
  return { db }
}

const batch = (deleted: number): Batch => ({ deleted, file_ids: null })

describe('applyRetention', () => {
  it('keeps everything when no retention period is set, but still purges old raw events', async () => {
    const { db } = fakeDb(null, [], [3])
    const out = await applyRetention(db as never)
    expect(out).toEqual({ responses: 0, events: 3, more: false })
    expect(db.$queryRaw).not.toHaveBeenCalled()
  })

  it('deletes and decrements the counters in one statement per batch (files go to the trash trigger)', async () => {
    const { db } = fakeDb(30, [batch(RETENTION_BATCH), batch(3)])
    const out = await applyRetention(db as never)
    expect(out).toMatchObject({ responses: RETENTION_BATCH + 3, more: false })
    expect(db.$queryRaw).toHaveBeenCalledTimes(2)
    // No per-form count(*) and no interactive transaction: the counter moves by the rows deleted.
    expect(db.$transaction).not.toHaveBeenCalled()
    const text = (db.$queryRaw.mock.calls[0]![0] as TemplateStringsArray).join('?')
    expect(text).toContain('GREATEST(f.response_count - t.n, 0)')
    expect(text).not.toContain('count(*)::int FROM responses r WHERE r.form_id')
  })

  it('stops after the per-run cap and says there is more', async () => {
    const full = Array.from({ length: RETENTION_MAX_BATCHES + 2 }, () => batch(RETENTION_BATCH))
    const { db } = fakeDb(7, full)
    const out = await applyRetention(db as never)
    expect(out.responses).toBe(RETENTION_BATCH * RETENTION_MAX_BATCHES)
    expect(out.more).toBe(true)
  })

  it('clears the cached Summary and contacts strip once responses went (F-029)', async () => {
    const summaryKey = 'report:summary:00000000-0000-4000-8000-000000000001:30d:::UTC'
    await cache.set(summaryKey, { n: 1 }, 300)
    await cache.set(OVERVIEW_KEY, { n: 1 }, 600)
    expect(await cache.get(summaryKey)).not.toBeNull()
    expect(await cache.get(OVERVIEW_KEY)).not.toBeNull()
    // Nothing deleted: the cache stays.
    await applyRetention(fakeDb(30, [batch(0)]).db as never)
    expect(await cache.get(OVERVIEW_KEY)).not.toBeNull()
    // Rows deleted: both go.
    await applyRetention(fakeDb(30, [batch(3)]).db as never)
    expect(await cache.get(summaryKey)).toBeNull()
    expect(await cache.get(OVERVIEW_KEY)).toBeNull()
  })

  it('stops starting batches when the time budget is spent', async () => {
    let t = 0
    const { db } = fakeDb(7, Array.from({ length: 5 }, () => batch(RETENTION_BATCH)))
    const out = await applyRetention(db as never, { now: () => (t += 20_000) })
    expect(out.more).toBe(true)
    expect(out.responses).toBeLessThan(RETENTION_BATCH * 5)
  })
})

describe('hourlyMaintenance', () => {
  it('runs each bounded sweep once, then empties the file trash for a while', async () => {
    // 2 rows each: under a full sweep batch, so the rate-limit sweep stops after one statement.
    const db = {
      $executeRaw: vi.fn(async (_s: TemplateStringsArray, ..._v: unknown[]) => 2),
      // Exports whose job stopped: none.
      $queryRaw: vi.fn(async (_s: TemplateStringsArray, ..._v: unknown[]) => [] as unknown[]),
    }
    const drain = vi.fn(async () => ({ removed: 4, failed: 0, more: false }))
    expect(await hourlyMaintenance(db as never, { drain })).toEqual({
      closedForms: 2,
      webhookDeliveries: 2,
      rateLimits: 2,
      presence: 2,
      responseHours: 2,
      exports: 2,
      staleExports: 0,
      files: 4,
    })
    const sql = db.$executeRaw.mock.calls.map((c) => c[0].join('?'))
    expect(sql[0]).toContain("status = 'closed'")
    expect(sql[1]).toContain('webhook_deliveries')
    expect(sql[2]).toContain('intelform_rate_limits')
    expect(sql[3]).toContain('form_presence')
    expect(sql[4]).toContain('form_response_hours')
    expect(sql[5]).toContain('intelform_exports')
    expect(db.$queryRaw.mock.calls[0]![0].join('?')).toContain("status = 'failed'")
    expect(drain).toHaveBeenCalledTimes(1)
  })
})
