import { Hono } from 'hono'
import {
  presenceInput,
  type BuilderCapabilities,
  type PresenceResponse,
  type WebhookDeliveriesResponse,
  type WebhookDelivery,
  type WebhookInfo,
  type WebhookSecretResponse,
  type WebhookSendResult,
} from '../../../shared/api-builder'
import { formDefinition, type FormDefinition, type FormField } from '../../../shared/form/definition'
import { sql } from '../../db/client'
import { emailEnabled } from '../../lib/email'
import { notFound } from '../../lib/errors'
import { rateLimit } from '../../lib/rate-limit'
import { getTurnstileConfig } from '../../lib/settings'
import { readBody, uuidParam } from '../../lib/validate'
import { deliverWebhook, resendDelivery, rotateWebhookSecret } from '../../lib/webhooks'
import { requirePermission, requireUser, type AppEnv } from '../../middleware/auth'
import { leavePresence, othersOn, touchPresence } from './presence'

/**
 * Builder tools that are not plain form CRUD (that is Agent D's /api/forms). Owned by: Agent F
 * (builder). Mounted at BUILDER_API (shared/api-builder.ts).
 */
export const builderRoutes = new Hono<AppEnv>().use(requireUser)

const GONE = 'That form no longer exists'

/** Throws a 404 unless the form exists. */
async function assertForm(id: string) {
  const [row] = await sql`SELECT 1 FROM forms WHERE id = ${id}`
  if (!row) throw notFound(GONE)
}

/** Everything the test send needs, draft included: only that route pays for it. */
async function formRow(id: string) {
  const [row] = await sql<
    {
      id: string
      title: string
      version: number | null
      revision: number
      updated_by: string | null
      updated_by_name: string | null
      draft: unknown
      webhook_secret: string | null
    }[]
  >`
    SELECT f.id, f.title, v.version, f.revision, f.updated_by, u.name AS updated_by_name, f.draft, f.webhook_secret
    FROM forms f
    LEFT JOIN users u ON u.id = f.updated_by
    LEFT JOIN form_versions v ON v.id = f.published_version_id
    WHERE f.id = ${id}
  `
  if (!row) throw notFound(GONE)
  return row
}

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------

builderRoutes.get('/capabilities', requirePermission('forms.view'), async (c) => {
  const [email, turnstile] = await Promise.all([emailEnabled(), getTurnstileConfig()])
  return c.json<BuilderCapabilities>({ emailEnabled: email, turnstileConfigured: !!(turnstile.siteKey && turnstile.secret) })
})

// ---------------------------------------------------------------------------
// Presence (viewers count too: they see who is editing)
// ---------------------------------------------------------------------------

builderRoutes.post('/forms/:id/presence', requirePermission('forms.view'), async (c) => {
  const id = uuidParam(c, 'id', GONE)
  const { tabId } = await readBody(c, presenceInput)
  // Polled every 20 s per open builder tab: read only the save marker, never the draft.
  const [row] = await sql<{ revision: number; updated_by: string | null; updated_by_name: string | null }[]>`
    SELECT f.revision, f.updated_by, u.name AS updated_by_name
    FROM forms f LEFT JOIN users u ON u.id = f.updated_by
    WHERE f.id = ${id}
  `
  if (!row) throw notFound(GONE)
  const user = c.var.user
  // Viewers can't edit, so they never trigger the "someone else is editing" banner for others.
  if (user.role !== 'viewer') touchPresence(id, tabId, user)
  return c.json<PresenceResponse>({
    others: othersOn(id, tabId, user.id),
    revision: row.revision,
    updatedBy: row.updated_by && row.updated_by_name ? { id: row.updated_by, name: row.updated_by_name } : null,
  })
})

builderRoutes.delete('/forms/:id/presence/:tabId', requirePermission('forms.view'), (c) => {
  const id = uuidParam(c, 'id', GONE)
  leavePresence(id, c.req.param('tabId'), c.var.user.id)
  return c.body(null, 204)
})

// ---------------------------------------------------------------------------
// Webhook: secret, test, delivery log, resend
// ---------------------------------------------------------------------------

builderRoutes.get('/forms/:id/webhook', requirePermission('forms.edit'), async (c) => {
  const [row] = await sql<{ has_secret: boolean }[]>`SELECT webhook_secret IS NOT NULL AS has_secret FROM forms WHERE id = ${uuidParam(c, 'id', GONE)}`
  if (!row) throw notFound(GONE)
  return c.json<WebhookInfo>({ hasSecret: row.has_secret })
})

/** Generates or regenerates the signing secret. The only time it is shown. */
builderRoutes.post('/forms/:id/webhook/secret', requirePermission('forms.edit'), async (c) => {
  const id = uuidParam(c, 'id', GONE)
  await assertForm(id)
  const secret = await rotateWebhookSecret(id)
  return c.json<WebhookSecretResponse>({ secret })
})

builderRoutes.post('/forms/:id/webhook/test', requirePermission('forms.edit'), async (c) => {
  const id = uuidParam(c, 'id', GONE)
  await rateLimit(`webhook-test:${c.var.user.id}`, 20, 600)
  const row = await formRow(id)
  const parsed = formDefinition.safeParse(row.draft)
  const result = await deliverWebhook(id, testPayload(row, parsed.success ? parsed.data : null), { test: true })
  return c.json<WebhookSendResult>({
    ok: result.ok,
    statusCode: result.statusCode,
    durationMs: result.durationMs,
    error: result.error,
    deliveryId: result.deliveryId,
  })
})

builderRoutes.get('/forms/:id/webhook/deliveries', requirePermission('forms.edit'), async (c) => {
  const id = uuidParam(c, 'id', GONE)
  await assertForm(id)
  const rows = await sql<Omit<WebhookDelivery, 'ok'>[]>`
    SELECT id, created_at AS "createdAt", url, status_code AS "statusCode", duration_ms AS "durationMs",
      response_body AS "responseBody", error, is_test AS "isTest", response_id AS "responseId"
    FROM webhook_deliveries WHERE form_id = ${id}
    ORDER BY created_at DESC LIMIT 100
  `
  const deliveries = rows.map((r) => ({
    ...r,
    createdAt: new Date(r.createdAt).toISOString(),
    ok: r.error === null && r.statusCode !== null && r.statusCode >= 200 && r.statusCode < 300,
  }))
  return c.json<WebhookDeliveriesResponse>({ deliveries })
})

builderRoutes.post('/forms/:id/webhook/deliveries/:deliveryId/resend', requirePermission('forms.edit'), async (c) => {
  const id = uuidParam(c, 'id', GONE)
  const deliveryId = uuidParam(c, 'deliveryId', 'That delivery is no longer in the log')
  await rateLimit(`webhook-test:${c.var.user.id}`, 20, 600)
  const [owned] = await sql`SELECT 1 FROM webhook_deliveries WHERE id = ${deliveryId} AND form_id = ${id}`
  if (!owned) throw notFound('That delivery is no longer in the log')
  const result = await resendDelivery(deliveryId)
  return c.json<WebhookSendResult>({
    ok: result.ok,
    statusCode: result.statusCode,
    durationMs: result.durationMs,
    error: result.error,
    deliveryId: result.deliveryId,
  })
})

/**
 * Same keys and answer shapes as a real delivery (`webhookPayload` in respondent/notify.ts), with
 * sample answers, so a receiver built against "Send test" also handles real responses.
 */
export function testPayload(form: { id: string; title: string; version: number | null }, def: FormDefinition | null) {
  const answers: Record<string, { label: string; type: string; value: unknown }> = {}
  for (const f of def?.fields ?? []) {
    if (f.type === 'section_break') continue
    answers[f.id] = { label: f.label, type: f.type, value: sampleValue(f) }
  }
  return {
    type: 'response.test',
    test: true,
    form_id: form.id,
    form_title: form.title,
    form_version: form.version,
    response_id: null,
    submitted_at: new Date().toISOString(),
    answers,
  }
}

function sampleValue(f: FormField): unknown {
  switch (f.type) {
    case 'email':
      return 'sam@example.com'
    case 'name':
      return f.props.split ? { first: 'Sam', last: 'Lee' } : 'Sam Lee'
    case 'phone':
      return '+14155550123'
    case 'address':
      return { street: '1 Main St', city: 'Springfield', country: 'US' }
    case 'country':
      return 'US'
    case 'number':
      return 42
    case 'url':
      return 'https://example.com'
    case 'date':
      return new Date().toISOString().slice(0, 10)
    case 'time':
      return '09:30'
    case 'single_choice':
    case 'dropdown':
      return f.props.options[0] ? { option: f.props.options[0].id } : null
    case 'multiple_choice':
    case 'picture_choice':
      return f.props.options.slice(0, 1).map((o) => ({ option: o.id }))
    case 'yes_no':
      return true
    case 'rating':
      return f.props.scale
    case 'nps':
      return 9
    case 'signature':
      return { url: 'https://example.com/signature.png' }
    case 'consent':
      return { accepted: true, at: new Date().toISOString(), text: f.props.text }
    default:
      return 'Sample answer'
  }
}
