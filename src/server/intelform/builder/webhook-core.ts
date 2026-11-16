import type {FormDefinition, FormField} from '../../../lib/intelform/form/definition';

/**
 * Outbound webhooks, the pure parts (no database, no network): URL rules, the signing secret,
 * the signature, the form's webhook config and the "Send test" payload.
 *
 * Signed per the Standard Webhooks spec (https://www.standardwebhooks.com), so receivers can
 * verify with the `standardwebhooks` libraries:
 *
 *   webhook-id:        msg_<responseId> (msg_test_<uuid> for tests); unchanged on Resend
 *   webhook-timestamp: unix seconds
 *   webhook-signature: v1,<base64 HMAC-SHA256(key, id.timestamp.body)>
 *
 * The secret is `whsec_` + base64(32 random bytes), per form, in forms.webhook_secret (a
 * server-only column; IntelForm's APP_SECRET encryption is gone with its own auth).
 *
 * On the Worker there is no DNS lookup to hook: the URL is checked here (scheme, credentials,
 * literal private addresses, local names) and the platform refuses its internal network itself
 * (`403 Egress blocked`). Redirects are never followed.
 */

export const WEBHOOK_TIMEOUT_MS = 10_000;
export const MAX_BODY_CAPTURE = 1024;
export const HTTPS_REQUIRED = 'Use an https:// address. Webhooks carry answers, so plain http:// isn’t allowed.';

export class UnsafeWebhookUrl extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeWebhookUrl';
  }
}

function ipv4Octets(host: string): number[] | null {
  const parts = host.split('.');
  if (parts.length !== 4) return null;
  const octets = parts.map(p => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  return octets.every(o => o >= 0 && o <= 255) ? octets : null;
}

function privateIpv4([a, b, c]: number[]): boolean {
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b! >= 64 && b! <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b! >= 16 && b! <= 31) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a! >= 224
  );
}

/** Expands an IPv6 literal to 8 groups of 4 hex digits; null when it isn't one. */
function expandIpv6(host: string): string[] | null {
  let h = host.toLowerCase();
  if (!h.includes(':')) return null;
  // A dotted IPv4 tail (::ffff:1.2.3.4): turn it into two groups.
  const dotted = h.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const o = ipv4Octets(dotted[2]!);
    if (!o) return null;
    h = `${dotted[1]}${((o[0]! << 8) | o[1]!).toString(16)}:${((o[2]! << 8) | o[3]!).toString(16)}`;
  }
  const halves = h.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 1) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...tail];
  if (!groups.every(g => /^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map(g => g.padStart(4, '0'));
}

/** True for loopback, private, link-local, CGNAT, metadata, multicast and other non-public literals. */
export function isPrivateAddress(host: string): boolean {
  const bare = host.replace(/^\[|\]$/g, '');
  const v4 = ipv4Octets(bare);
  if (v4) return privateIpv4(v4);
  const g = expandIpv6(bare);
  if (!g) return false; // not an IP literal
  const first = parseInt(g[0]!, 16);
  const allZeroUntil = (n: number) => g.slice(0, n).every(x => x === '0000');
  if (allZeroUntil(6)) return true; // ::, ::1 and the deprecated IPv4-compatible ::a.b.c.d
  if (allZeroUntil(5) && g[5] === 'ffff') return true; // IPv4-mapped
  if (g[0] === '0064' && g[1] === 'ff9b') return true; // NAT64
  if (g[0] === '0100' && g[1] === '0000' && g[2] === '0000' && g[3] === '0000') return true; // discard
  if (g[0] === '2001' && parseInt(g[1]!, 16) < 0x200) return true; // IETF protocol assignments
  if (g[0] === '2001' && g[1] === '0db8') return true; // documentation
  if (g[0] === '2002') return true; // 6to4
  if ((first & 0xfe00) === 0xfc00) return true; // unique local
  if ((first & 0xffc0) === 0xfe80 || (first & 0xffc0) === 0xfec0) return true; // link / site local
  if ((first & 0xff00) === 0xff00) return true; // multicast
  return false;
}

/**
 * Validates a webhook URL before saving or sending; throws UnsafeWebhookUrl with words for
 * people. `allowHttp` only off production (local receivers).
 */
export function assertSafeUrl(raw: string, opts: {allowHttp?: boolean} = {}): URL {
  if (raw.length > 2000) throw new UnsafeWebhookUrl('Use a shorter URL');
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeWebhookUrl('Enter a full URL starting with https://');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new UnsafeWebhookUrl('Use an https:// address');
  if (url.protocol === 'http:' && !opts.allowHttp) throw new UnsafeWebhookUrl(HTTPS_REQUIRED);
  if (url.username || url.password) {
    throw new UnsafeWebhookUrl('Remove the user name and password from the URL; use a custom header instead');
  }
  // "localhost." and "db.internal." are the same names as without the final dot.
  const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.+$/, '');
  if (!host) throw new UnsafeWebhookUrl('Enter a full URL starting with https://');
  if (!opts.allowHttp) {
    if (isPrivateAddress(host)) throw new UnsafeWebhookUrl('Webhooks can’t be sent to private or local network addresses');
    if (/^(localhost|.*\.localhost|.*\.local|.*\.internal|.*\.home\.arpa)$/i.test(host) || !/[.:]/.test(host)) {
      throw new UnsafeWebhookUrl('Webhooks can’t be sent to local host names');
    }
  }
  return url;
}

// ------------------------------------------------------------------ signing --

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const bin = atob(text);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function generateWebhookSecret(): string {
  return `whsec_${toBase64(crypto.getRandomValues(new Uint8Array(32)))}`;
}

/** The `webhook-signature` header value for one message. */
export async function signWebhook(secret: string, id: string, timestamp: number, body: string): Promise<string> {
  const keyBytes = fromBase64(secret.startsWith('whsec_') ? secret.slice(6) : secret);
  const key = await crypto.subtle.importKey('raw', keyBytes, {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${timestamp}.${body}`));
  return `v1,${toBase64(new Uint8Array(mac))}`;
}

// ------------------------------------------------------------------- config --

export interface WebhookConfig {
  enabled: boolean;
  url: string | null;
  headers: [string, string][];
}

const RESERVED = /^(host|content-length|content-type|transfer-encoding|connection|user-agent|cookie|webhook-.*|cf-.*|x-forwarded-.*)$/i;

/** The form's webhook from its stored settings, with unusable custom headers dropped. */
export function readWebhookConfig(settings: unknown): WebhookConfig {
  const w = ((settings as {webhook?: Record<string, unknown>} | null)?.webhook ?? {}) as Record<string, unknown>;
  const url = typeof w.url === 'string' && w.url.trim() ? w.url.trim() : null;
  const headers: [string, string][] = [];
  if (Array.isArray(w.headers)) {
    for (const h of w.headers as Record<string, unknown>[]) {
      const k = String(h?.key ?? h?.name ?? '').trim();
      if (k) headers.push([k, String(h?.value ?? '')]);
    }
  }
  return {
    enabled: w.enabled !== false && !!url,
    url,
    headers: headers
      .filter(([k, v]) => /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(k) && !RESERVED.test(k) && !/[\r\n]/.test(v))
      .slice(0, 20),
  };
}

// --------------------------------------------------------------- test payload --

/**
 * Same keys and answer shapes as a real delivery, with sample answers, so a receiver built
 * against "Send test" also handles real responses.
 */
export function testPayload(form: {id: string; title: string; version: number | null}, def: FormDefinition | null, now = new Date()) {
  const answers: Record<string, {label: string; type: string; value: unknown}> = {};
  for (const f of def?.fields ?? []) {
    if (f.type === 'section_break') continue;
    answers[f.id] = {label: f.label, type: f.type, value: sampleValue(f, now)};
  }
  return {
    type: 'response.test',
    test: true,
    form_id: form.id,
    form_title: form.title,
    form_version: form.version,
    response_id: null,
    submitted_at: now.toISOString(),
    answers,
  };
}

export function sampleValue(f: FormField, now = new Date()): unknown {
  switch (f.type) {
    case 'email':
      return 'sam@example.com';
    case 'name':
      return f.props.split ? {first: 'Sam', last: 'Lee'} : 'Sam Lee';
    case 'phone':
      return '+14155550123';
    case 'address':
      return {street: '1 Main St', city: 'Springfield', country: 'US'};
    case 'country':
      return 'US';
    case 'number':
      return 42;
    case 'url':
      return 'https://example.com';
    case 'date':
      return now.toISOString().slice(0, 10);
    case 'time':
      return '09:30';
    case 'single_choice':
    case 'dropdown':
      return f.props.options[0] ? {option: f.props.options[0].id} : null;
    case 'multiple_choice':
    case 'picture_choice':
      return f.props.options.slice(0, 1).map(o => ({option: o.id}));
    case 'yes_no':
      return true;
    case 'rating':
      return f.props.scale;
    case 'nps':
      return 9;
    case 'signature':
      return {url: 'https://example.com/signature.png'};
    case 'consent':
      return {accepted: true, at: now.toISOString(), text: f.props.text};
    default:
      return 'Sample answer';
  }
}

/** A delivery's outcome from its stored columns: still queued, or delivered with a 2xx. */
export function deliveryState(row: {statusCode: number | null; durationMs: number | null; error: string | null}) {
  const pending = row.durationMs === null && row.error === null;
  const ok = !pending && row.error === null && row.statusCode !== null && row.statusCode >= 200 && row.statusCode < 300;
  return {pending, ok};
}

/** Words for a failed fetch, never a stack or internal detail. */
export function describeFetchError(err: unknown): string {
  const e = err as {name?: string; message?: string} | null;
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError') return 'Timed out after 10 seconds';
  const msg = String(e?.message ?? err ?? '');
  if (/egress blocked/i.test(msg)) return 'Webhooks can’t be sent to that address';
  if (/ENOTFOUND|getaddrinfo|dns/i.test(msg)) return 'The host name could not be found';
  if (/ECONNREFUSED|refused/i.test(msg)) return 'The connection was refused';
  return 'The endpoint could not be reached';
}
