import type {FormDefinition, FormField} from '../../../lib/intelform/form/definition';
import {assertSafeUrl as checkUrl, WebhookUrlError, type UrlPolicy} from '../webhooks/ssrf';

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

export class UnsafeWebhookUrl extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeWebhookUrl';
  }
}

/**
 * Validates a webhook URL before saving or sending; throws UnsafeWebhookUrl with words for
 * people. One check for every webhook path (../webhooks/ssrf): `allowHttp` and
 * `allowPrivate` are separate, and only your own machine (config.localDev) may target private
 * or local hosts. Defaults to the running site's policy (urlPolicy()).
 */
export function assertSafeUrl(raw: string, policy: Partial<UrlPolicy> = {}): URL {
  try {
    return checkUrl(raw, {allowHttp: policy.allowHttp ?? false, allowPrivate: policy.allowPrivate ?? false});
  } catch (err) {
    if (err instanceof WebhookUrlError) throw new UnsafeWebhookUrl(err.message);
    throw err;
  }
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
