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
  const candidate = chain[chain.length - 1 - hops]
  return candidate ? normalizeIp(candidate) : (normalizeIp(chain[0] ?? '') ?? socket)
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

/** Rate-limit key part for the caller: the salted IP hash, or "unknown" without a socket (tests). */
export function ipKey(c: Context): string {
  const ip = clientIp(c)
  return ip ? hashIp(ip) : 'unknown'
}
