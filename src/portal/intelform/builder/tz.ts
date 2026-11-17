/**
 * Close-on-date helpers: the creator picks a wall-clock time in a time zone; settings.closeAt
 * stores the matching instant as ISO 8601 with offset.
 */

function partsIn(date: Date, timeZone: string) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]))
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute, s: +p.second }
}

const pad2 = (n: number) => String(n).padStart(2, '0')

/** Minutes the zone is ahead of UTC at that instant. */
export function zoneOffsetMinutes(date: Date, timeZone: string): number {
  const p = partsIn(date, timeZone)
  const asUtc = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s)
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60_000)
}

function formatOffset(offset: number): string {
  const abs = Math.abs(offset)
  return `${offset < 0 ? '-' : '+'}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`
}

/** The wall-clock minute an instant shows in `timeZone`, as if it were UTC (ms). */
function wallClockMs(date: Date, timeZone: string): number {
  const p = partsIn(date, timeZone)
  return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi)
}

function localString(date: Date, timeZone: string): string {
  const p = partsIn(date, timeZone)
  return `${p.y}-${pad2(p.mo)}-${pad2(p.d)}T${pad2(p.h)}:${pad2(p.mi)}`
}

export interface ZonedTime {
  /** The instant, ISO 8601 with the zone's offset at that instant. */
  iso: string
  /** The wall-clock time the instant shows in the zone ("YYYY-MM-DDTHH:mm"). */
  local: string
  /**
   * True when the requested wall-clock time does not exist in the zone (it falls in a
   * spring-forward gap) and was moved forward by the gap's length: 02:30 on the night New York
   * skips 02:00-03:00 becomes 03:30 EDT.
   */
  shifted: boolean
}

/**
 * Resolves a wall-clock time in `timeZone` to an instant, like Temporal's "compatible"
 * disambiguation: a repeated time (clocks go back) takes the earlier instant; a skipped time
 * (clocks go forward) moves forward by the length of the gap and says so (`shifted`), so the
 * stored instant always reads back as the time it names and is never earlier than the one
 * picked. Null for malformed or impossible input (30 February, an unknown zone).
 */
export function resolveZonedTime(local: string, timeZone: string): ZonedTime | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local)
  if (!m) return null
  const [, y, mo, d, h, mi] = m.map(Number)
  const wall = Date.UTC(y, mo - 1, d, h, mi)
  const w = new Date(wall)
  if (w.getUTCFullYear() !== y || w.getUTCMonth() !== mo - 1 || w.getUTCDate() !== d || w.getUTCHours() !== h || w.getUTCMinutes() !== mi) {
    return null
  }
  try {
    // The offsets a day either side bracket any one transition near this time.
    const before = zoneOffsetMinutes(new Date(wall - 86_400_000), timeZone)
    const after = zoneOffsetMinutes(new Date(wall + 86_400_000), timeZone)
    const candidates = [...new Set([before, after, zoneOffsetMinutes(new Date(wall - before * 60_000), timeZone)])]
      .map((offset) => wall - offset * 60_000)
      .filter((t) => wallClockMs(new Date(t), timeZone) === wall)
      .sort((a, b) => a - b)
    // No offset shows this wall-clock time: it is inside a gap. The offset in force before the
    // gap lands the same distance past it.
    const instant = new Date(candidates[0] ?? wall - before * 60_000)
    const shown = localString(instant, timeZone)
    return { iso: `${shown}:00${formatOffset(zoneOffsetMinutes(instant, timeZone))}`, local: shown, shifted: candidates.length === 0 }
  } catch {
    return null
  }
}

/**
 * "2026-11-01T09:00" in `timeZone` → "2026-11-01T09:00:00+01:00". Null for bad input. A time a
 * spring-forward change skips resolves to the time after the gap (`resolveZonedTime`).
 */
export function zonedToIso(local: string, timeZone: string): string | null {
  return resolveZonedTime(local, timeZone)?.iso ?? null
}

/** ISO instant → "YYYY-MM-DDTHH:mm" wall-clock time in `timeZone`, for a datetime-local input. */
export function isoToZoned(iso: string, timeZone: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return localString(date, timeZone)
}

export function timeZones(): string[] {
  try {
    const list = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? []
    return list.includes('UTC') ? list : ['UTC', ...list]
  } catch {
    return ['UTC']
  }
}

export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

/**
 * The note under the close date when the picked time was moved past a clock change
 * ("02:30 doesn't exist … closes at 03:30 instead"), or null when it was kept as picked.
 */
export function shiftedTimeNote(requested: string, resolved: ZonedTime | null, timeZone: string): string | null {
  if (!resolved?.shifted) return null
  const time = (local: string) => local.slice(11, 16)
  return `${time(requested)} doesn’t exist on that day in ${timeZone.replace(/_/g, ' ')} (the clocks go forward), so the form closes at ${time(resolved.local)} instead.`
}
