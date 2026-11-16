import { describe, expect, it } from 'vitest'
import { isoToZoned, zonedToIso } from './tz'

describe('close date time zones', () => {
  it('converts wall-clock time in a zone to an ISO instant and back', () => {
    expect(zonedToIso('2026-11-01T09:00', 'UTC')).toBe('2026-11-01T09:00:00+00:00')
    expect(zonedToIso('2026-07-01T09:00', 'Europe/Berlin')).toBe('2026-07-01T09:00:00+02:00')
    expect(zonedToIso('2026-12-01T09:00', 'Europe/Berlin')).toBe('2026-12-01T09:00:00+01:00')
    expect(zonedToIso('2026-12-01T09:30', 'Asia/Kolkata')).toBe('2026-12-01T09:30:00+05:30')
    expect(zonedToIso('2026-12-01T09:00', 'America/New_York')).toBe('2026-12-01T09:00:00-05:00')
    const iso = zonedToIso('2026-03-29T12:15', 'Europe/London')!
    expect(isoToZoned(iso, 'Europe/London')).toBe('2026-03-29T12:15')
    expect(isoToZoned('2026-12-01T14:00:00Z', 'America/New_York')).toBe('2026-12-01T09:00')
  })

  it('rejects malformed input', () => {
    expect(zonedToIso('tomorrow', 'UTC')).toBeNull()
    expect(isoToZoned('nope', 'UTC')).toBe('')
  })
})
