import type {PrismaClient} from '../../../generated/prisma/client';

/** Time zones for the contacts filters and CSV. */

/** A zone `Intl` knows (the runtime's own list). */
export function intlKnowsZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', {timeZone: tz});
    return true;
  } catch {
    return false;
  }
}

// Per isolate: zones Postgres confirmed (or refused). Bounded so odd input can't grow it.
const known = new Map<string, boolean>();
const KNOWN_MAX = 200;

/** A time zone both Postgres and Intl know; UTC otherwise. */
export async function safeTz(db: Pick<PrismaClient, '$queryRaw'>, tz: string | undefined): Promise<string> {
  if (!tz || tz === 'UTC' || tz.length > 64 || !intlKnowsZone(tz)) return 'UTC';
  const cached = known.get(tz);
  if (cached !== undefined) return cached ? tz : 'UTC';
  let ok = false;
  try {
    const rows = await db.$queryRaw<{ok: number}[]>`SELECT 1 AS ok FROM pg_timezone_names WHERE name = ${tz} LIMIT 1`;
    ok = rows.length > 0;
  } catch {
    return 'UTC';
  }
  if (known.size < KNOWN_MAX) known.set(tz, ok);
  return ok ? tz : 'UTC';
}

/** Today's date (YYYY-MM-DD) in `tz`. */
export function todayIn(tz: string, now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit'}).format(now);
}
