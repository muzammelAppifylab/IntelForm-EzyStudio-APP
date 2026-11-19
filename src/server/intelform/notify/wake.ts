import { JobRejected, runsJobsLocally, sendJob } from '../../../platform/background'

/**
 * Wakes the notify job (`intelform-notify`, src/server/background.ts) instead of a schedule that
 * ran every minute whether or not anything came in. A saved response calls `wakeNotifyJob()`:
 * ONE keyed job per minute, however many responses arrive, due two minutes on (the platform runs
 * a job due under 60 s ahead at once, so a run must start after the minute it serves has ended):
 *
 *   responses in 12:00:00–12:00:59   one job, key `notify-12:02`, at 12:02:00
 *
 * That run drains everything queued before it (notifications, confirmations, webhooks, the
 * contacts rollup, the forms' counters). Sends of the same minute share the key, so the platform
 * keeps one job; each Worker also remembers the key it last sent and skips the call for the rest
 * of that minute. A retry that is due later wakes the job for that minute (`wakeNotifyAt`). A
 * refused send is logged and never fails the submit: the 15-minute run drains whatever is left.
 *
 * Locally (the editor Preview, your own machine, tests) jobs would run inside the request, so
 * nothing is sent: as before, the queue is drained only when its job runs.
 */

export const NOTIFY_LIST = 'intelform-notify'

/** A run starts this many whole minutes after the minute it serves. */
const LEAD_MINUTES = 2

/** Test seams (never set in app code). */
export const wakeDeps: { send: typeof sendJob; local: () => boolean } = { send: sendJob, local: runsJobsLocally }

let lastKey = ''

const MINUTE = 60_000
/** `YYYY-MM-DDTHH:MM` of a time. */
export const minuteKey = (t: number) => new Date(t).toISOString().slice(0, 16)

/** The run for the responses saved now: the start of the minute after next. */
export function notifyRunAt(now: number): number {
  return Math.floor(now / MINUTE) * MINUTE + LEAD_MINUTES * MINUTE
}

async function send(requestUrl: string, at: number, label: string): Promise<boolean> {
  const key = `notify-${minuteKey(at)}`
  if (key === lastKey) return false
  lastKey = key
  if (wakeDeps.local()) return false
  try {
    await wakeDeps.send(requestUrl, NOTIFY_LIST, {}, { at: new Date(at), key, label })
    return true
  } catch (err) {
    console.warn(`[intelform] notify job not sent (${err instanceof JobRejected ? err.code : 'error'}); the 15-minute run drains the queue`)
    return false
  }
}

/** After a response is saved (never throws). True when this call sent the job. */
export function wakeNotifyJob(requestUrl: string, now = Date.now()): Promise<boolean> {
  return send(requestUrl, notifyRunAt(now), 'IntelForm: send notifications for new responses')
}

/**
 * Wakes the notify job for queued work due at `due` (a retry after its back-off): the first whole
 * minute at least a minute from now, keyed like the submit's so the two never run twice.
 */
export function wakeNotifyAt(requestUrl: string, due: number, now = Date.now()): Promise<boolean> {
  const at = Math.ceil(Math.max(due, now + MINUTE) / MINUTE) * MINUTE
  return send(requestUrl, at, 'IntelForm: retry response notifications')
}
