import { Hono } from 'hono'
import { appSettingsPatch, emailTestInput, type AppSettingsView, type SettingsTestResult } from '../../shared/settings-app'
import { sql } from '../db/client'
import { env } from '../env'
import { contentDisposition } from '../lib/csv'
import { exportAllResponsesZip } from '../lib/data-export'
import { emailEnabled, sendTestEmail } from '../lib/email'
import { logger } from '../lib/logger'
import { rateLimit } from '../lib/rate-limit'
import { getSetting, readSecret, secretState, secretUpdate, setSetting, settingsChanged, type AppSettings } from '../lib/settings'
import { storageStatus, testStorage } from '../lib/uploads'
import { readBody } from '../lib/validate'
import { requirePermission, requireUser, type AppEnv } from '../middleware/auth'

/**
 * Owner-only App settings (PRD "App settings"): general, branding, spam, email, storage, data.
 * Secrets are write-only: GET returns `{ set: boolean }` for them, never the value.
 */
export const settingsRoutes = new Hono<AppEnv>().use(requireUser, requirePermission('settings.manage'))

export async function settingsView(): Promise<AppSettingsView> {
  const [general, branding, turnstile, email, data] = await Promise.all([
    getSetting('general'),
    getSetting('branding'),
    getSetting('turnstile'),
    getSetting('email'),
    getSetting('data'),
  ])
  return {
    general,
    branding,
    spam: { turnstileSiteKey: turnstile.siteKey, turnstileSecret: secretState(turnstile.secret) },
    email: {
      driver: email.driver,
      fromName: email.fromName,
      fromAddress: email.fromAddress,
      replyTo: email.replyTo,
      smtpHost: email.smtpHost,
      smtpPort: email.smtpPort,
      smtpSecure: email.smtpSecure,
      smtpUser: email.smtpUser,
      smtpPass: secretState(email.smtpPass),
      resendApiKey: secretState(email.resendApiKey),
      postmarkToken: secretState(email.postmarkToken),
      envOverride: env.EMAIL_DRIVER ?? null,
      enabled: await emailEnabled(),
    },
    storage: storageStatus(),
    data,
  }
}

/** Drops undefined keys so a PATCH only touches what was sent. */
function defined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>
}

type EmailPatch = Partial<Pick<AppSettings['email'], 'smtpHost' | 'smtpPort' | 'smtpSecure' | 'smtpUser'>>

const smtpTarget = (e: EmailPatch & Pick<AppSettings['email'], 'smtpSecure'>) => ({
  host: (e.smtpHost ?? '').trim().toLowerCase().replace(/\.$/, ''),
  port: e.smtpPort ?? (e.smtpSecure ? 465 : 587),
  user: e.smtpUser ?? '',
})

/** Whether the patch sends the SMTP login somewhere else: another host, port or username. */
export function smtpEndpointChanged(stored: AppSettings['email'], patch: EmailPatch): boolean {
  const before = smtpTarget(stored)
  const after = smtpTarget({ ...stored, ...defined(patch) })
  return before.host !== after.host || before.port !== after.port || before.user !== after.user
}

settingsRoutes.get('/', async (c) => c.json<AppSettingsView>(await settingsView()))

settingsRoutes.patch('/', async (c) => {
  const input = await readBody(c, appSettingsPatch)
  await sql.begin(async (tx) => {
    if (input.general) await setSetting('general', defined(input.general) as Partial<AppSettings['general']>, tx)
    if (input.branding) await setSetting('branding', defined(input.branding), tx)
    if (input.data) await setSetting('data', defined(input.data), tx)
    if (input.spam) {
      const { turnstileSiteKey, turnstileSecret } = input.spam
      await setSetting('turnstile', defined({ siteKey: turnstileSiteKey === '' ? null : turnstileSiteKey, secret: secretUpdate(turnstileSecret) }), tx)
    }
    if (input.email) {
      const { smtpPass, resendApiKey, postmarkToken, ...plain } = input.email
      // A new server or login without a new password drops the stored one, so a hijacked
      // session can't point SMTP at its own host and "Send test" the password to it.
      const smtpMoved = smtpPass === undefined && smtpEndpointChanged(await getSetting('email', tx), plain)
      await setSetting(
        'email',
        defined({
          ...plain,
          smtpPass: smtpMoved ? null : secretUpdate(smtpPass),
          resendApiKey: secretUpdate(resendApiKey),
          postmarkToken: secretUpdate(postmarkToken),
        }) as Partial<AppSettings['email']>,
        tx,
      )
    }
  })
  // Listeners ran inside the transaction; tell them again now that the values are committed.
  if (input.email) settingsChanged('email')
  if (input.general) settingsChanged('general')
  return c.json<AppSettingsView>(await settingsView())
})

// ---------------------------------------------------------------------------
// "Test" buttons
// ---------------------------------------------------------------------------

/**
 * Checks the stored Turnstile secret with Cloudflare. A dummy token is always rejected; what
 * matters is *why*: "invalid-input-secret" means the key is wrong.
 */
settingsRoutes.post('/spam/test', async (c) => {
  await rateLimit(`settings-test:${c.var.user.id}`, 20, 10 * 60)
  const { siteKey, secret } = await getSetting('turnstile')
  const plain = readSecret(secret)
  if (!siteKey || !plain) return c.json<SettingsTestResult>({ ok: false, message: 'Add both the site key and the secret key first.' })
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: plain, response: 'XXXX.DUMMY.TOKEN.XXXX' }),
      signal: AbortSignal.timeout(10_000),
    })
    const j = (await res.json()) as { success: boolean; 'error-codes'?: string[] }
    const codes = j['error-codes'] ?? []
    if (codes.includes('invalid-input-secret') || codes.includes('missing-input-secret')) {
      return c.json<SettingsTestResult>({ ok: false, message: 'Cloudflare rejected the secret key. Copy it again from the Turnstile dashboard.' })
    }
    return c.json<SettingsTestResult>({ ok: true, message: 'Cloudflare accepted the secret key.' })
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'turnstile test failed')
    return c.json<SettingsTestResult>({ ok: false, message: 'Couldn’t reach Cloudflare. Check the server’s internet access and try again.' })
  }
})

/** Verifies the provider, then sends one email now (to the Owner unless `to` is given). */
settingsRoutes.post('/email/test', async (c) => {
  await rateLimit(`settings-test:${c.var.user.id}`, 20, 10 * 60)
  const { to } = await readBody(c, emailTestInput)
  try {
    await sendTestEmail(to ?? c.var.user.email)
    return c.json<SettingsTestResult>({ ok: true, message: `Test email sent to ${to ?? c.var.user.email}.` })
  } catch (err) {
    return c.json<SettingsTestResult>({ ok: false, message: `The test email failed: ${(err as Error).message}`.slice(0, 400) })
  }
})

/** Writes and deletes a 1-byte file in storage. */
settingsRoutes.post('/storage/test', async (c) => {
  await rateLimit(`settings-test:${c.var.user.id}`, 20, 10 * 60)
  try {
    const { driver } = await testStorage()
    return c.json<SettingsTestResult>({
      ok: true,
      message: driver === 'bunny' ? 'Bunny storage accepted a test upload.' : 'Local storage works. Set the Bunny variables to use the CDN.',
    })
  } catch (err) {
    return c.json<SettingsTestResult>({ ok: false, message: `The test upload failed: ${(err as Error).message}`.slice(0, 400) })
  }
})

/** All responses as a ZIP with one CSV per form, streamed. */
settingsRoutes.get('/data/export.zip', async (c) => {
  await rateLimit(`export-all:${c.var.user.id}`, 5, 10 * 60)
  const stream = await exportAllResponsesZip()
  const date = new Date().toISOString().slice(0, 10)
  return new Response(stream, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': contentDisposition(`responses-${date}.zip`),
      'Cache-Control': 'no-store',
    },
  })
})
