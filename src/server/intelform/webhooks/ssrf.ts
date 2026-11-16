/**
 * Webhook URL checks (SSRF), Worker-safe: no `node:net`, no DNS. What a URL may point at is
 * decided from the URL alone, on save AND again right before every send:
 *
 *   - `https:` only on the live site (`http:` too off production, for a local receiver);
 *   - no user name or password in the URL (use a custom header);
 *   - no IP literal in a private, loopback, link-local, CGNAT, metadata, documentation,
 *     multicast or reserved range (IPv4, IPv6, IPv4-mapped / NAT64 / 6to4 forms included);
 *   - no local names (`localhost`, `*.localhost`, `*.local`, `*.internal`, `*.home.arpa`,
 *     single-label hosts).
 *
 * A public host name that RESOLVES to a private address can't be checked here (a Worker has no
 * DNS lookup); the platform answers `403 Egress blocked` for its internal network, and every
 * delivery uses `redirect: 'manual'`, so a redirect can't lead past these checks either.
 * The WHATWG URL parser already turns `0x7f.1`, `2130706433` and `127.1` into `127.0.0.1`.
 */

export const HTTPS_REQUIRED = 'Use an https:// address. Webhooks carry answers, so plain http:// isn’t allowed.'

/** A refused webhook URL. Routes answer 422 `validation_failed` with `fields: {url: [message]}`. */
export class WebhookUrlError extends Error {
  readonly code = 'validation_failed'
  readonly field = 'url'
}

export interface UrlPolicy {
  /** Plain `http:` allowed (off production only). */
  allowHttp: boolean
  /** Private and local targets allowed (your own machine only). */
  allowPrivate: boolean
}

// ---------------------------------------------------------------------------
// IP literals
// ---------------------------------------------------------------------------

/** `a.b.c.d` → its 4 bytes, or null when it isn't a dotted-decimal IPv4 address. */
export function parseIPv4(text: string): number[] | null {
  const parts = text.split('.')
  if (parts.length !== 4) return null
  const out: number[] = []
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null
    const n = Number(p)
    if (n > 255) return null
    out.push(n)
  }
  return out
}

/** An IPv6 address (no brackets, no zone) → its 8 hextets, or null. Embedded IPv4 is accepted. */
export function parseIPv6(text: string): number[] | null {
  let s = text.toLowerCase()
  if (!s.includes(':') || s.includes('%')) return null
  // A trailing dotted IPv4 (::ffff:1.2.3.4) becomes two hextets.
  const lastColon = s.lastIndexOf(':')
  const tail = s.slice(lastColon + 1)
  if (tail.includes('.')) {
    const v4 = parseIPv4(tail)
    if (!v4) return null
    s = `${s.slice(0, lastColon + 1)}${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`
  }
  const halves = s.split('::')
  if (halves.length > 2) return null
  const read = (part: string): number[] | null => {
    if (part === '') return []
    const out: number[] = []
    for (const h of part.split(':')) {
      if (!/^[0-9a-f]{1,4}$/.test(h)) return null
      out.push(parseInt(h, 16))
    }
    return out
  }
  const head = read(halves[0])
  const rest = halves.length === 2 ? read(halves[1]) : []
  if (!head || !rest) return null
  if (halves.length === 1) return head.length === 8 ? head : null
  const missing = 8 - head.length - rest.length
  if (missing < 1) return null
  return [...head, ...Array.from({ length: missing }, () => 0), ...rest]
}

const V4_BLOCKED: [number[], number][] = [
  [[0, 0, 0, 0], 8], // "this network"
  [[10, 0, 0, 0], 8],
  [[100, 64, 0, 0], 10], // CGNAT
  [[127, 0, 0, 0], 8],
  [[169, 254, 0, 0], 16], // link local, cloud metadata
  [[172, 16, 0, 0], 12],
  [[192, 0, 0, 0], 24],
  [[192, 0, 2, 0], 24],
  [[192, 88, 99, 0], 24],
  [[192, 168, 0, 0], 16],
  [[198, 18, 0, 0], 15],
  [[198, 51, 100, 0], 24],
  [[203, 0, 113, 0], 24],
  [[224, 0, 0, 0], 4], // multicast
  [[240, 0, 0, 0], 4], // reserved, broadcast
]

function inPrefix(bits: number[], net: number[], prefix: number, width: number): boolean {
  // bits/net are arrays of `width`-bit words.
  let left = prefix
  for (let i = 0; i < net.length && left > 0; i++) {
    const take = Math.min(width, left)
    const mask = take === width ? (1 << width) - 1 : ((1 << take) - 1) << (width - take)
    if ((bits[i] & mask) !== (net[i] & mask)) return false
    left -= take
  }
  return true
}

function v4Private(b: number[]): boolean {
  return V4_BLOCKED.some(([net, prefix]) => inPrefix(b, net, prefix, 8))
}

const V6_BLOCKED: [string, number][] = [
  ['::', 96], // unspecified, loopback, the deprecated IPv4-compatible ::a.b.c.d
  ['::ffff:0:0', 96], // IPv4-mapped
  ['64:ff9b::', 96], // NAT64
  ['64:ff9b:1::', 48],
  ['100::', 64], // discard
  ['2001::', 23], // IETF protocol assignments (Teredo, ORCHID…)
  ['2001:db8::', 32], // documentation
  ['2002::', 16], // 6to4
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link local
  ['fec0::', 10], // deprecated site-local
  ['ff00::', 8], // multicast
]
const V6_NETS = V6_BLOCKED.map(([net, prefix]) => [parseIPv6(net)!, prefix] as const)

/**
 * True for loopback, private, link-local, CGNAT, metadata, multicast and other non-public
 * addresses, and for anything that isn't an IP address at all (fail closed).
 */
export function isPrivateAddress(address: string): boolean {
  const host = address.replace(/^\[|\]$/g, '')
  const v4 = parseIPv4(host)
  if (v4) return v4Private(v4)
  const v6 = parseIPv6(host)
  if (v6) return V6_NETS.some(([net, prefix]) => inPrefix(v6, net, prefix, 16))
  return true
}

/** True when the host is an IP literal (v4 or v6, brackets allowed). */
export function isIpLiteral(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '')
  return parseIPv4(h) !== null || parseIPv6(h) !== null
}

const LOCAL_NAME = /^(localhost|.*\.localhost|.*\.local|.*\.internal|.*\.intranet|.*\.lan|.*\.home\.arpa|.*\.corp)$/i

// ---------------------------------------------------------------------------
// The check
// ---------------------------------------------------------------------------

/** Validates a webhook URL before saving or sending. Throws `WebhookUrlError` with words for people. */
export function assertSafeUrl(raw: string, policy: UrlPolicy): URL {
  if (typeof raw !== 'string' || !raw.trim()) throw new WebhookUrlError('Enter a full URL starting with https://')
  if (raw.length > 2000) throw new WebhookUrlError('Use a shorter URL')
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    throw new WebhookUrlError('Enter a full URL starting with https://')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new WebhookUrlError('Use an https:// address')
  // Checked again at send time, so an http URL saved before this rule is refused and logged.
  if (url.protocol === 'http:' && !policy.allowHttp) throw new WebhookUrlError(HTTPS_REQUIRED)
  if (url.username || url.password) {
    throw new WebhookUrlError('Remove the user name and password from the URL; use a custom header instead')
  }
  // "localhost." and "db.internal." are the same names as without the final dot.
  const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.+$/, '')
  if (!host) throw new WebhookUrlError('Enter a full URL starting with https://')
  if (!policy.allowPrivate) {
    if (isIpLiteral(host)) {
      if (isPrivateAddress(host)) throw new WebhookUrlError('Webhooks can’t be sent to private or local network addresses')
    } else if (LOCAL_NAME.test(host) || !host.includes('.')) {
      throw new WebhookUrlError('Webhooks can’t be sent to local host names')
    }
  }
  return url
}
