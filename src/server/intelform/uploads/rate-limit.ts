import type {PrismaClient} from '../../../generated/prisma/client';

/**
 * Fixed-window rate limits in `intelform_rate_limits` (one upsert per check), as the old app kept
 * them in `rate_limits`. Keys are namespaced by the caller and never hold a raw IP address.
 */
export async function hitRateLimit(
  db: PrismaClient,
  key: string,
  limit: number,
  windowSeconds: number
): Promise<{ok: true} | {ok: false; retryAfter: number}> {
  const rows = await db.$queryRaw<{count: number; retry: number}[]>`
    INSERT INTO intelform_rate_limits (key, window_start, window_seconds, count)
    VALUES (${key}, date_bin(make_interval(secs => ${windowSeconds}::int), now(), 'epoch'), ${windowSeconds}::int, 1)
    ON CONFLICT (key, window_start) DO UPDATE SET count = intelform_rate_limits.count + 1
    RETURNING count::int AS count,
      ceil(extract(epoch FROM (window_start + make_interval(secs => window_seconds) - now())))::int AS retry
  `;
  const row = rows[0];
  if (!row || row.count <= limit) return {ok: true};
  return {ok: false, retryAfter: Math.max(1, row.retry)};
}

/** "a minute" / "N minutes", for a 429 message. */
export function waitText(seconds: number): string {
  return seconds < 90 ? 'a minute' : `${Math.ceil(seconds / 60)} minutes`;
}

/**
 * The address block one client controls: an IPv4 address as is, an IPv6 address as its /64
 * (a home router is handed a whole /64, so counting each address would let one client rotate).
 */
export function addressBlock(ip: string): string {
  const raw = ip.trim().toLowerCase();
  if (!raw.includes(':')) return raw;
  const s = raw.split('%')[0]!;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (mapped) return mapped[1]!;
  const halves = s.split('::');
  if (halves.length > 2) return s;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 ? (halves[1] ? halves[1].split(':') : []) : null;
  const groups = tail === null ? head : [...head, ...Array<string>(Math.max(0, 8 - head.length - tail.length)).fill('0'), ...tail];
  if (groups.length < 4) return s;
  return `${groups
    .slice(0, 4)
    .map(g => (parseInt(g, 16) || 0).toString(16))
    .join(':')}::/64`;
}

const enc = new TextEncoder();
const ipKeys = new Map<string, Promise<CryptoKey>>();

/** A keyed, one-way fingerprint of the caller's address block, for rate-limit keys. */
export async function callerKey(secret: string, ip: string | null | undefined): Promise<string> {
  if (!ip) return 'unknown';
  let key = ipKeys.get(secret);
  if (!key) {
    key = crypto.subtle.importKey('raw', enc.encode(`intelform:ip:${secret}`), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
    ipKeys.set(secret, key);
  }
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', await key, enc.encode(addressBlock(ip))));
  let hex = '';
  for (const b of mac.subarray(0, 16)) hex += b.toString(16).padStart(2, '0');
  return hex;
}
