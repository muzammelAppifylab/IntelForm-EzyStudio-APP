import {afterEach, describe, expect, it, vi} from 'vitest';

import {JobRejected} from '../../src/platform/background';
import {NOTIFY_LIST, notifyRunAt, wakeDeps, wakeNotifyAt, wakeNotifyJob} from '../../src/server/intelform/notify/wake';

/** The notify job is woken by submits: one keyed job a minute, never a schedule. */
describe('wakeNotifyJob', () => {
  const real = {...wakeDeps};
  afterEach(() => Object.assign(wakeDeps, real));
  const live = () => {
    const send = vi.fn(async () => ({}) as never);
    Object.assign(wakeDeps, {send, local: () => false});
    return send;
  };

  it('sends ONE job a minute, due at the start of the minute after next, keyed by that minute', async () => {
    const send = live();
    const t = Date.parse('2026-11-19T10:00:05Z');
    expect(await wakeNotifyJob('https://site.example/x', t)).toBe(true);
    // The rest of the minute: this Worker sends nothing more (the platform would dedupe anyway).
    for (let s = 6; s < 55; s += 7) expect(await wakeNotifyJob('https://site.example/x', t + s * 1000)).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('https://site.example/x', NOTIFY_LIST, {}, expect.objectContaining({at: new Date('2026-11-19T10:02:00Z'), key: 'notify-2026-11-19T10:02'}));
    // Always at least 60 s ahead, so the platform waits for the minute to end.
    expect(notifyRunAt(Date.parse('2026-11-19T10:00:59.900Z')) - Date.parse('2026-11-19T10:00:59.900Z')).toBeGreaterThan(60_000);
    // The next minute: the next job.
    expect(await wakeNotifyJob('https://site.example/x', Date.parse('2026-11-19T10:01:00Z'))).toBe(true);
    expect(send).toHaveBeenLastCalledWith(expect.any(String), NOTIFY_LIST, {}, expect.objectContaining({key: 'notify-2026-11-19T10:03'}));
  });

  it('a refused send never fails the submit', async () => {
    const send = live();
    send.mockRejectedValueOnce(new JobRejected('busy', 'E_JOBS_RATE_LIMITED', 429));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(wakeNotifyJob('https://site.example/x', Date.parse('2026-11-19T11:00:00Z'))).resolves.toBe(false);
    warn.mockRestore();
  });

  it('locally nothing is sent (the job would run inside the request)', async () => {
    const send = vi.fn();
    Object.assign(wakeDeps, {send, local: () => true});
    expect(await wakeNotifyJob('https://site.example/x', Date.parse('2026-11-19T12:00:00Z'))).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it('a retry wakes the job for its own minute, at least a minute ahead, on the same keys', async () => {
    const send = live();
    const now = Date.parse('2026-11-19T13:00:10Z');
    await wakeNotifyAt('https://site.example/x', now + 5 * 60_000, now);
    expect(send).toHaveBeenLastCalledWith(expect.any(String), NOTIFY_LIST, {}, expect.objectContaining({key: 'notify-2026-11-19T13:06'}));
    await wakeNotifyAt('https://site.example/x', now - 60_000, now);
    expect(send).toHaveBeenLastCalledWith(expect.any(String), NOTIFY_LIST, {}, expect.objectContaining({key: 'notify-2026-11-19T13:02'}));
  });
});
