import { describe, expect, it } from 'vitest'
import { ApiError } from './errors'
import { createPool, hashPassword, publicPool, teamPool, verifyFormPassword, verifyPassword } from './password'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => (resolve = r))
  return { promise, resolve }
}

/** Fill a pool's running slots and waiting line with jobs that finish only when released. */
function saturate(pool: { run: (fn: () => Promise<void>) => Promise<void> }, slots: number) {
  const gate = deferred()
  const jobs = Array.from({ length: slots }, () => pool.run(() => gate.promise))
  return {
    release: async () => {
      gate.resolve()
      await Promise.all(jobs)
    },
  }
}

describe('password pools', () => {
  it('runs up to the limit at once, queues up to the cap, then rejects with a 503', async () => {
    const pool = createPool(2, 3)
    const { release } = saturate(pool, 5)
    expect(pool.running).toBe(2)
    expect(pool.waiting).toBe(3)

    const err = await pool.run(async () => 'late').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ status: 503, code: 'busy', message: 'The server is busy. Try again in a moment.' })

    await release()
    expect(pool.running).toBe(0)
    expect(pool.waiting).toBe(0)
    // Capacity comes back once the line drains.
    await expect(pool.run(async () => 'ok')).resolves.toBe('ok')
  })

  it('hands a freed slot to the next in line and keeps concurrency bounded', async () => {
    const pool = createPool(1, 10)
    let active = 0
    let peak = 0
    const order: number[] = []
    const job = (n: number) =>
      pool.run(async () => {
        active++
        peak = Math.max(peak, active)
        await new Promise((r) => setTimeout(r, 1))
        order.push(n)
        active--
      })
    await Promise.all([job(1), job(2), job(3), job(4)])
    expect(peak).toBe(1)
    expect(order).toEqual([1, 2, 3, 4])
    expect(pool.running).toBe(0)
  })

  it('frees the slot when a job throws', async () => {
    const pool = createPool(1, 0)
    await expect(pool.run(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom')
    await expect(pool.run(async () => 1)).resolves.toBe(1)
  })

  it('a saturated public pool rejects unlocks but does not delay team password work', async () => {
    const hash = await hashPassword('correct horse')
    const { release } = saturate(publicPool, 2 + 16)
    try {
      await expect(verifyFormPassword(hash, 'correct horse')).rejects.toMatchObject({ status: 503, code: 'busy' })
      // Team work goes straight to its own pool: nothing waits behind the public flood.
      expect(teamPool.running).toBe(0)
      await expect(verifyPassword(hash, 'correct horse')).resolves.toBe(true)
      await expect(verifyPassword(hash, 'wrong')).resolves.toBe(false)
    } finally {
      await release()
    }
    await expect(verifyFormPassword(hash, 'correct horse')).resolves.toBe(true)
  })

  it('treats a malformed hash as a wrong password, not as busy', async () => {
    await expect(verifyPassword('not-a-hash', 'x')).resolves.toBe(false)
    await expect(verifyFormPassword('not-a-hash', 'x')).resolves.toBe(false)
  })
})
