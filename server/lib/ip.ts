import { getConnInfo } from '@hono/node-server/conninfo'
import type { Context } from 'hono'
import { isIP } from 'node:net'
import { env } from '../env'
import { hashIp } from './crypto'

/**
 * The client's IP address, as far as we can trust it.
 *
 * TRUSTED_PROXY_HOPS=0 (default): the socket address; X-Forwarded-For is ignored because the
 * client controls it. With N trusted proxies in front, each appends the address it saw, so the
 * client is the Nth entry from the right of socket + X-Forwarded-For. Entries further left were
 * written by the client and are never used.
 *
 * When that entry is missing (a chain shorter than the hop count, e.g. a request that reached
 * the app without passing every proxy) or isn't an IP, the socket address is used. Never fall
 * back to an entry further left: those are the ones the client wrote.
 */
export function clientIp(c: Context, hops: number = env.TRUSTED_PROXY_HOPS): string | null {
  const socket = socketAddress(c)
  if (hops <= 0) return socket
  const forwarded = (c.req.header('x-forwarded-for') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  // Chain as seen by us: [client?, proxy1, …, proxyN-1] from XFF, then the socket (proxy N).
  const chain = socket ? [...forwarded, socket] : forwarded
  const index = chain.length - 1 - hops
  return (index >= 0 ? normalizeIp(chain[index]) : null) ?? socket
}

function socketAddress(c: Context): string | null {
  try {
    return normalizeIp(getConnInfo(c).remote.address ?? '')
  } catch {
    // No Node socket (app.request() in tests, or a non-Node runtime).
    return null
  }
}

/** Strips ports and the IPv4-mapped IPv6 prefix; returns null for anything that isn't an IP. */
export function normalizeIp(raw: string): string | null {
  let ip = raw.trim()
  if (ip.startsWith('[')) ip = ip.slice(1, ip.indexOf(']'))
  else if (/^\d+\.\d+\.\d+\.\d+:\d+$/.test(ip)) ip = ip.slice(0, ip.lastIndexOf(':'))
  if (ip.toLowerCase().startsWith('::ffff:') && isIP(ip.slice(7)) === 4) ip = ip.slice(7)
  return isIP(ip) ? ip.toLowerCase() : null
}

/**
 * The address block one client controls, for rate limiting: an IPv4 address stays as is, an
 * IPv6 address becomes its /64 prefix (`2001:db8:0:1::/64`). One host or home router is
 * normally handed a whole /64, so counting each /128 separately would let a single client
 * rotate through billions of addresses. An IPv4-mapped address (`::ffff:...`) maps back to
 * the IPv4 address. Takes the output of `normalizeIp`; anything else is returned unchanged.
 */
export function rateLimitBucket(ip: string): string {
  if (isIP(ip) !== 6) return ip
  const groups = ipv6Groups(ip)
  if (!groups) return ip
  // ::ffff:a.b.c.d written in hex (::ffff:102:304), which normalizeIp leaves as IPv6.
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    return [groups[6] >> 8, groups[6] & 255, groups[7] >> 8, groups[7] & 255].join('.')
  }
  return `${groups.slice(0, 4).map((g) => g.toString(16)).join(':')}::/64`
}

/** The eight 16-bit groups of an IPv6 address (handles `::`, a dotted IPv4 tail and a %zone). */
function ipv6Groups(ip: string): number[] | null {
  let s = ip.split('%')[0]
  const tail = /^(.*:)(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(s)
  if (tail) {
    const [a, b, c, d] = tail.slice(2).map(Number)
    s = `${tail[1]}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`
  }
  const halves = s.split('::')
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(':') : []
  const rest = halves.length === 2 ? (halves[1] ? halves[1].split(':') : []) : null
  const parts = rest === null ? head : [...head, ...Array<string>(8 - head.length - rest.length).fill('0'), ...rest]
  if (parts.length !== 8 || parts.some((p) => !/^[0-9a-f]{1,4}$/i.test(p))) return null
  return parts.map((p) => parseInt(p, 16))
}

/** Rate-limit key part for an address: the salted hash of its `rateLimitBucket`. */
export function ipKeyFor(ip: string): string {
  return hashIp(rateLimitBucket(ip))
}

/**
 * Rate-limit key part for the caller: the salted hash of their address block (IPv4 address
 * or IPv6 /64), or "unknown" without a socket (tests). Stored hashes (responses, sessions)
 * use the full address via `hashIp`; only rate limits pool the /64.
 */
export function ipKey(c: Context): string {
  const ip = clientIp(c)
  return ip ? ipKeyFor(ip) : 'unknown'
}
