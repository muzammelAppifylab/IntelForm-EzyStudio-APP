import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import {
  applyRetention,
  background,
  fileIdOf,
  hourlyMaintenance,
  RETENTION_BATCH,
  RETENTION_MAX_BATCHES,
} from '../../src/server/background'

describe('background lists', () => {
  it('has a handler for every list and schedule in background.json', () => {
    const manifest = JSON.parse(readFileSync(new URL('../../background.json', import.meta.url), 'utf8')) as {
      lists: Record<string, unknown>
      schedules: Record<string, { list?: string }>
    }
    const needed = new Set([...Object.keys(manifest.lists), ...Object.entries(manifest.schedules).map(([n, s]) => s.list ?? n)])
    for (const list of needed) expect(background.handlers[list], list).toBeTypeOf('function')
    expect(Object.keys(background.handlers).sort()).toEqual([
      'intelform-maintenance',
      'intelform-response-notify',
      'intelform-retention',
      'intelform-webhook-deliver',
      'intelform-webhooks',
    ])
  })
})

describe('fileIdOf', () => {
  it('finds the platform file id in a stored answer url', () => {
    expect(fileIdOf('/__platform/files/abc_123/sig.png')).toBe('abc_123')
    expect(fileIdOf('https://forms.example.com/__platform/files/xyz/s.png?x=1')).toBe('xyz')
    expect(fileIdOf('https://example.com/other.png')).toBeNull()
    expect(fileIdOf(null)).toBeNull()
  })
})

function fakeDb(retentionDays: number | null, batches: { form_id: string; urls: string[] | null }[][], events: number[] = [0]) {
  const queue = [...batches]
  const eventQueue = [...events]
  const tx = { $queryRaw: vi.fn(async () => []), $executeRaw: vi.fn(async () => 1) }
  const db = {
    intelformSettings: { findUnique: vi.fn(async () => (retentionDays === undefined ? null : { retentionDays })) },
    $queryRaw: vi.fn(async () => queue.shift() ?? []),
    $executeRaw: vi.fn(async (s: TemplateStringsArray) => (s.join('').includes('form_events') ? (eventQueue.shift() ?? 0) : 0)),
    $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  }
  return { db, tx }
}

const rows = (n: number, form = 'f1', urls: string[] | null = []) => Array.from({ length: n }, () => ({ form_id: form, urls }))

describe('applyRetention', () => {
  it('keeps everything when no retention period is set, but still purges old raw events', async () => {
    const { db } = fakeDb(null, [], [3])
    const out = await applyRetention(db as never, { removeFile: vi.fn() })
    expect(out).toEqual({ responses: 0, files: 0, events: 3, more: false })
    expect(db.$queryRaw).not.toHaveBeenCalled()
  })

  it('deletes in batches, removes signature files and recounts touched forms', async () => {
    const removeFile = vi.fn(async () => ({ ok: true }))
    const { db, tx } = fakeDb(30, [
      [...rows(RETENTION_BATCH - 1, 'f2'), { form_id: 'f1', urls: ['/__platform/files/sig1/s.png', '/__platform/files/sig1/s.png'] }],
      rows(3, 'f1', null),
    ])
    const out = await applyRetention(db as never, { removeFile })
    expect(out).toMatchObject({ responses: RETENTION_BATCH + 3, files: 1, more: false })
    expect(removeFile).toHaveBeenCalledWith('sig1')
    expect(db.$queryRaw).toHaveBeenCalledTimes(2)
    expect(db.$transaction).toHaveBeenCalledTimes(2)
    // The lock and the recount both take the sorted form ids.
    expect((tx.$queryRaw.mock.calls[0] as unknown[]).slice(1)).toEqual([['f1', 'f2']])
  })

  it('stops after the per-run cap and says there is more', async () => {
    const full = Array.from({ length: RETENTION_MAX_BATCHES + 2 }, () => rows(RETENTION_BATCH))
    const { db } = fakeDb(7, full)
    const out = await applyRetention(db as never, { removeFile: vi.fn() })
    expect(out.responses).toBe(RETENTION_BATCH * RETENTION_MAX_BATCHES)
    expect(out.more).toBe(true)
  })

  it('stops starting batches when the time budget is spent', async () => {
    let t = 0
    const { db } = fakeDb(7, Array.from({ length: 5 }, () => rows(RETENTION_BATCH)))
    const out = await applyRetention(db as never, { removeFile: vi.fn(), now: () => (t += 20_000) })
    expect(out.more).toBe(true)
    expect(out.responses).toBeLessThan(RETENTION_BATCH * 5)
  })

  it('a file that cannot be removed does not fail the run', async () => {
    const { db } = fakeDb(7, [[{ form_id: 'f1', urls: ['/__platform/files/a/x.png'] }]])
    const out = await applyRetention(db as never, {
      removeFile: async () => {
        throw new Error('no key')
      },
    })
    expect(out).toMatchObject({ responses: 1, files: 0 })
  })
})

describe('hourlyMaintenance', () => {
  it('runs each bounded sweep once', async () => {
    const db = { $executeRaw: vi.fn(async (_s: TemplateStringsArray, ..._v: unknown[]) => 2) }
    expect(await hourlyMaintenance(db as never)).toEqual({ closedForms: 2, webhookDeliveries: 2, rateLimits: 2, presence: 2 })
    const sql = db.$executeRaw.mock.calls.map((c) => c[0].join('?'))
    expect(sql[0]).toContain("status = 'closed'")
    expect(sql[1]).toContain('webhook_deliveries')
    expect(sql[2]).toContain('intelform_rate_limits')
    expect(sql[3]).toContain('form_presence')
  })
})
