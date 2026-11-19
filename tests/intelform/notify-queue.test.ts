import { describe, expect, it, vi } from 'vitest'
import { DontRetry } from '../../src/platform/background'
import { DRAIN_MAX_ATTEMPTS, drainNotifyQueue, NotifyDeferred } from '../../src/server/intelform/notify'

/**
 * The notify queue's drain against a stand-in for intelform_notify_queue: the claim statement
 * takes unclaimed rows (and rows whose claim the test expired) oldest first, up to its LIMIT.
 */

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

interface Row {
  id: string
  order: number
  claimed: boolean
  attempts: number
}

function queue(n: number, attempts = 0) {
  const rows = new Map<string, Row>()
  for (let i = 1; i <= n; i++) rows.set(id(i), { id: id(i), order: i, claimed: false, attempts })
  const claims: number[] = []
  const executed: string[] = []
  const db = {
    $queryRaw: vi.fn(async (s: TemplateStringsArray, ...values: unknown[]) => {
      const text = s.join('?')
      expect(text).toContain('FOR UPDATE SKIP LOCKED')
      expect(text).toContain('UPDATE intelform_notify_queue')
      const limit = Number(values[0])
      claims.push(limit)
      const free = [...rows.values()].filter((r) => !r.claimed).sort((a, b) => a.order - b.order).slice(0, limit)
      for (const r of free) {
        r.claimed = true
        r.attempts++
      }
      return free.map((r) => ({ response_id: r.id, attempts: r.attempts }))
    }),
    $executeRaw: vi.fn(async (s: TemplateStringsArray, ...values: unknown[]) => {
      const text = s.join('?')
      executed.push(text)
      const ids = values.find(Array.isArray) as string[]
      if (text.startsWith('DELETE FROM intelform_notify_queue')) for (const k of ids) rows.delete(k)
      else if (text.includes('SET claimed_at = NULL')) {
        for (const k of ids) {
          const r = rows.get(k)!
          r.claimed = false
          r.attempts = Math.max(r.attempts - 1, 0)
        }
      } else throw new Error(`unexpected statement: ${text}`)
      return ids.length
    }),
  }
  /** The back-off is over (or the run that held them died): claimed rows can be taken again. */
  const expire = () => rows.forEach((r) => (r.claimed = false))
  return { db: db as never, rows, claims, expire, executed }
}

describe('drainNotifyQueue', () => {
  it('works every claimed response, oldest first, and deletes the ones that finished', async () => {
    const q = queue(7)
    const seen: string[] = []
    const out = await drainNotifyQueue(q.db, 'https://x.test/', { batch: 3, work: async (r) => void seen.push(r) })
    expect(out).toEqual({ done: 7, failed: 0, more: false })
    expect(seen).toEqual([1, 2, 3, 4, 5, 6, 7].map(id))
    expect(q.rows.size).toBe(0)
    // 3 + 3 + 1: the short batch ends the run without another claim.
    expect(q.claims).toEqual([3, 3, 3])
  })

  it('keeps a failed response claimed for a retry, and lets it go after the last attempt', async () => {
    const q = queue(2)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const work = async (r: string) => {
      if (r === id(2)) throw new Error('Resend: 503 ada@example.com')
    }
    expect(await drainNotifyQueue(q.db, 'https://x.test/', { work })).toEqual({ done: 1, failed: 1, more: false })
    expect([...q.rows.values()]).toEqual([{ id: id(2), order: 2, claimed: true, attempts: 1 }])

    // Still claimed (back-off): a run right after does not take it.
    expect(await drainNotifyQueue(q.db, 'https://x.test/', { work })).toEqual({ done: 0, failed: 0, more: false })

    for (let i = 2; i <= DRAIN_MAX_ATTEMPTS; i++) {
      q.expire()
      expect((await drainNotifyQueue(q.db, 'https://x.test/', { work })).failed).toBe(1)
    }
    expect(q.rows.size).toBe(0)
    // Counts only: never the error's words (they may hold an address).
    const logged = [...warn.mock.calls, ...error.mock.calls].map((c) => String(c[0])).join('\n')
    expect(logged).toContain(`let go after ${DRAIN_MAX_ATTEMPTS} attempts`)
    expect(logged).not.toContain('@')
    warn.mockRestore()
    error.mockRestore()
  })

  it('lets go at once of a DontRetry, and of a row claimed past its last attempt', async () => {
    const q = queue(2)
    q.rows.get(id(2))!.attempts = DRAIN_MAX_ATTEMPTS // a run died during its last attempt
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const work = vi.fn(async () => {
      throw new DontRetry('no valid id')
    })
    expect(await drainNotifyQueue(q.db, 'https://x.test/', { work })).toEqual({ done: 0, failed: 1, more: false })
    expect(work).toHaveBeenCalledTimes(1)
    expect(q.rows.size).toBe(0)
    error.mockRestore()
  })

  it('stops starting work when the budget is spent, gives back what it did not start, and says more', async () => {
    const q = queue(10)
    let t = 0
    const work = async () => {
      t += 10
    }
    const out = await drainNotifyQueue(q.db, 'https://x.test/', { budgetMs: 25, now: () => t, batch: 5, concurrency: 1, work })
    expect(out).toEqual({ done: 3, failed: 0, more: true })
    // The two claimed but never started are free again, their attempt not counted.
    const left = [...q.rows.values()]
    expect(left).toHaveLength(7)
    expect(left.filter((r) => r.claimed)).toHaveLength(0)
    expect(left.find((r) => r.id === id(4))!.attempts).toBe(0)
  })

  it('says more when its quota per run is used and responses are waiting', async () => {
    const q = queue(6)
    const out = await drainNotifyQueue(q.db, 'https://x.test/', { maxPerRun: 4, batch: 2, work: async () => {} })
    expect(out).toEqual({ done: 4, failed: 0, more: true })
    expect(q.rows.size).toBe(2)
    expect(q.claims).toEqual([2, 2])
  })

  it('works a few at a time', async () => {
    const q = queue(12)
    let running = 0
    let peak = 0
    const work = async () => {
      running++
      peak = Math.max(peak, running)
      await new Promise((r) => setTimeout(r, 1))
      running--
    }
    expect((await drainNotifyQueue(q.db, 'https://x.test/', { batch: 12, concurrency: 4, work })).done).toBe(12)
    expect(peak).toBe(4)
  })

  it('gives back, uncounted, a response only the webhook breaker held back', async () => {
    const q = queue(2)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const work = async (r: string) => {
      if (r === id(2)) throw new NotifyDeferred('held back')
    }
    expect(await drainNotifyQueue(q.db, 'https://x.test/', { work })).toEqual({ done: 1, failed: 0, more: false })
    expect([...q.rows.values()]).toEqual([{ id: id(2), order: 2, claimed: false, attempts: 0 }])
    const held = q.executed.find((t) => t.includes('make_interval'))
    expect(held).toBeDefined()
    warn.mockRestore()
  })

  it('reads each claimed batch once before working it, and keeps going while one response is slow', async () => {
    const q = queue(9)
    const batches: string[][] = []
    const finishedAt: string[] = []
    const work = async (r: string) => {
      await new Promise((res) => setTimeout(res, r === id(1) ? 30 : 1))
      finishedAt.push(r)
    }
    const out = await drainNotifyQueue(q.db, 'https://x.test/', { batch: 3, concurrency: 2, work, prepare: async (ids) => void batches.push(ids) })
    expect(out.done).toBe(9)
    expect(batches).toEqual([[id(1), id(2), id(3)], [id(4), id(5), id(6)], [id(7), id(8), id(9)]])
    // The slow first response did not hold up the batches after it.
    expect(finishedAt.indexOf(id(1))).toBeGreaterThan(finishedAt.indexOf(id(5)))
  })

  it('does nothing on an empty queue', async () => {
    const q = queue(0)
    expect(await drainNotifyQueue(q.db, 'https://x.test/', { work: async () => {} })).toEqual({ done: 0, failed: 0, more: false })
    expect(q.claims).toHaveLength(1)
  })
})
