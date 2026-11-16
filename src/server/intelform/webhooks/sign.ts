import { randomBytes } from '../../../platform/auth/encoding'

/**
 * Outbound webhook signatures, per the Standard Webhooks spec (https://www.standardwebhooks.com),
 * so receivers can verify with the `standardwebhooks` libraries:
 *
 *   webhook-id:        msg_<responseId> (msg_test_<uuid> for tests); unchanged on a retry or Resend
 *   webhook-timestamp: unix seconds
 *   webhook-signature: v1,<base64 HMAC-SHA256(key, id.timestamp.body)>
 *
 * The secret is `whsec_` + base64(32 random bytes), per form, in forms.webhook_secret (server
 * only, never in settings). WebCrypto only: runs on the Worker and in Node tests.
 */

function toBase64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const bin = atob(text)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function generateWebhookSecret(): string {
  return `whsec_${toBase64(randomBytes(32))}`
}

/** The raw key bytes of a `whsec_…` secret (a bare base64 secret works too). */
export function secretKey(secret: string): Uint8Array<ArrayBuffer> {
  return fromBase64(secret.startsWith('whsec_') ? secret.slice(6) : secret)
}

/** The `webhook-signature` header value for one message. */
export async function signWebhook(secret: string, id: string, timestamp: number, body: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', secretKey(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${timestamp}.${body}`))
  return `v1,${toBase64(new Uint8Array(mac))}`
}
