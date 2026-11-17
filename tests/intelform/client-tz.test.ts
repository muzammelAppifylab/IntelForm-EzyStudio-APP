import { describe, expect, it } from 'vitest'
import { isoToZoned, resolveZonedTime, shiftedTimeNote, zonedToIso } from '../../src/portal/intelform/builder/tz'

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

// F-045: a wall-clock time inside a spring-forward gap must never be stored an hour early.
describe('close date across clock changes', () => {
  const gaps: [string, string, string, string][] = [
    // zone, picked (does not exist), stored ISO, reads back as
    ['America/New_York', '2026-03-08T02:30', '2026-03-08T03:30:00-04:00', '2026-03-08T03:30'],
    ['Europe/London', '2026-03-29T01:30', '2026-03-29T02:30:00+01:00', '2026-03-29T02:30'],
    ['Australia/Sydney', '2026-10-04T02:30', '2026-10-04T03:30:00+11:00', '2026-10-04T03:30'],
  ]

  it.each(gaps)('moves a skipped time in %s forward past the gap', (zone, picked, iso, back) => {
    const r = resolveZonedTime(picked, zone)!
    expect(r).toEqual({ iso, local: back, shifted: true })
    expect(zonedToIso(picked, zone)).toBe(iso)
    expect(isoToZoned(iso, zone)).toBe(back)
    // Never earlier than the time the creator picked.
    expect(new Date(iso).getTime()).toBeGreaterThan(new Date(zonedToIso(picked.replace(/T\d\d/, 'T00'), zone)!).getTime())
    expect(shiftedTimeNote(picked, r, zone)).toContain(`closes at ${back.slice(11)}`)
  })

  it('keeps times just around the gap exactly as picked', () => {
    expect(resolveZonedTime('2026-03-08T01:59', 'America/New_York')).toEqual({ iso: '2026-03-08T01:59:00-05:00', local: '2026-03-08T01:59', shifted: false })
    expect(resolveZonedTime('2026-03-08T03:00', 'America/New_York')).toEqual({ iso: '2026-03-08T03:00:00-04:00', local: '2026-03-08T03:00', shifted: false })
    expect(shiftedTimeNote('2026-03-08T03:00', resolveZonedTime('2026-03-08T03:00', 'America/New_York'), 'America/New_York')).toBeNull()
  })

  it('takes the earlier instant for a repeated time (clocks go back) and round-trips', () => {
    expect(zonedToIso('2026-11-01T01:30', 'America/New_York')).toBe('2026-11-01T01:30:00-04:00')
    expect(zonedToIso('2026-10-25T01:30', 'Europe/London')).toBe('2026-10-25T01:30:00+01:00')
    expect(zonedToIso('2026-04-05T02:30', 'Australia/Sydney')).toBe('2026-04-05T02:30:00+11:00')
    for (const [l, z] of [['2026-11-01T01:30', 'America/New_York'], ['2026-04-05T02:30', 'Australia/Sydney'], ['2026-06-01T09:00', 'Asia/Kathmandu']]) {
      expect(isoToZoned(zonedToIso(l, z)!, z)).toBe(l)
    }
  })

  it('rejects impossible dates and unknown zones', () => {
    expect(zonedToIso('2026-02-30T09:00', 'UTC')).toBeNull()
    expect(zonedToIso('2026-01-01T24:00', 'UTC')).toBeNull()
    expect(zonedToIso('2026-01-01T09:00', 'Not/AZone')).toBeNull()
  })
})
