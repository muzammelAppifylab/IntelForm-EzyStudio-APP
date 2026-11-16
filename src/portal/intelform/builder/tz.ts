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

/** Minutes the zone is ahead of UTC at that instant. */
export function zoneOffsetMinutes(date: Date, timeZone: string): number {
  const p = partsIn(date, timeZone)
  const asUtc = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s)
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60_000)
}

/** "2026-11-01T09:00" in `timeZone` → "2026-11-01T09:00:00+01:00". Null for bad input. */
export function zonedToIso(local: string, timeZone: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local)
  if (!m) return null
  const [, y, mo, d, h, mi] = m.map(Number)
  const guess = Date.UTC(y, mo - 1, d, h, mi)
  // Two passes settle DST edges.
  let offset = zoneOffsetMinutes(new Date(guess), timeZone)
  offset = zoneOffsetMinutes(new Date(guess - offset * 60_000), timeZone)
  const sign = offset < 0 ? '-' : '+'
  const abs = Math.abs(offset)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${local}:00${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
}

/** ISO instant → "YYYY-MM-DDTHH:mm" wall-clock time in `timeZone`, for a datetime-local input. */
export function isoToZoned(iso: string, timeZone: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const p = partsIn(date, timeZone)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${p.y}-${pad(p.mo)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}`
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
