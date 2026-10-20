import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Independent re-implementation of the `standardwebhooks` verify algorithm
 * (https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md),
 * used to prove our signatures verify for receivers. Not shared with the signing code on purpose.
 */
const TOLERANCE_SECONDS = 5 * 60

export function verifyStandardWebhook(secret: string, headers: Record<string, string | undefined>, payload: string, now = Date.now()): unknown {
  const id = headers['webhook-id']
  const ts = headers['webhook-timestamp']
  const sigHeader = headers['webhook-signature']
  if (!id || !ts || !sigHeader) throw new Error('Missing required headers')

  const timestamp = Number.parseInt(ts, 10)
  if (Number.isNaN(timestamp)) throw new Error('Invalid timestamp')
  const nowSec = Math.floor(now / 1000)
  if (nowSec - timestamp > TOLERANCE_SECONDS) throw new Error('Message timestamp too old')
  if (timestamp > nowSec + TOLERANCE_SECONDS) throw new Error('Message timestamp too new')

  const key = Buffer.from(secret.startsWith('whsec_') ? secret.substring('whsec_'.length) : secret, 'base64')
  const expected = createHmac('sha256', key).update(`${id}.${timestamp}.${payload}`).digest()

  for (const versioned of sigHeader.split(' ')) {
    const [version, signature] = versioned.split(',')
    if (version !== 'v1' || !signature) continue
    const got = Buffer.from(signature, 'base64')
    if (got.length === expected.length && timingSafeEqual(got, expected)) return JSON.parse(payload)
  }
  throw new Error('No matching signature found')
}
