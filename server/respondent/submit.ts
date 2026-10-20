import { randomUUID } from 'node:crypto'
import type { Context } from 'hono'
import * as z from 'zod'
import { submitInput, type SubmitInput, type SubmitResponse } from '../../shared/api-public'
import { formDefinition, type FormDefinition } from '../../shared/form/definition'
import { resolveLabels, type Labels } from '../../shared/form/labels'
import { validateSubmission } from '../../shared/form/logic'
import { formSettings } from '../../shared/form/settings'
import { isSignatureDataUrl, signatureBytes } from '../../shared/form/types/registry'
import { sql } from '../db/client'
import { ApiError } from '../lib/errors'
import { clientIp, ipKey } from '../lib/ip'
import { logger } from '../lib/logger'
import { rateLimit } from '../lib/rate-limit'
import { requestMeta } from '../lib/request-meta'
import { storeBuffer } from '../lib/uploads'
import { buildSearchText } from '../responses/format'
import { redirectWithAnswers } from './answers'
import { isClosed, requireForm, turnstileFor, type LoadedForm } from './load'
import { queueResponseJobs } from './notify'
import { checkUnlockToken, hashBrowserToken, readRenderToken } from './tokens'
import { verifyTurnstile } from './turnstile'
import './validators'

/**
 * POST /api/public/forms/:slug/responses: the submit pipeline, in the order of
 * docs/research/03-respondent.md "Spam pipeline":
 *
 *  1. body limit (3 MB at the app, 256 KB for everything but signatures here)
 *  2. live, close date, cap, password token
 *  3. rate limit: 10 per minute per IP per form
 *  4. honeypot + minimum fill time (a fake 200 on a hit)
 *  5. validateSubmission against the version the browser rendered
 *  6. Turnstile (when on and configured)
 *  7. one per browser
 *  8. cheap pre-checks (still live, cap, one per email), then signature uploads (PNG only)
 *  9. one transaction: one-per-email advisory lock + check, counter and cap, insert, jobs
 * 10. reply { ok, redirectUrl? }
 */

export const SUBMIT_RATE_LIMIT = 10
/** Anything faster than this from render to submit is a bot. */
export const MIN_FILL_MS = 2000
const MAX_ANSWERS_BYTES = 256 * 1024
const MAX_STARTED_AGO_MS = 30 * 24 * 60 * 60 * 1000
const MAX_TTC_MS = 24 * 60 * 60 * 1000
/** A browser that rendered the version just replaced may still submit it for this long. */
export const PREVIOUS_VERSION_GRACE_MS = 24 * 60 * 60 * 1000
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const fieldErrors = (errors: Record<string, string>) =>
  Object.fromEntries(Object.entries(errors).map(([k, v]) => [k, [v]])) as Record<string, string[]>

function closedError(form: LoadedForm, labels: Labels): ApiError {
  return new ApiError(403, 'form_closed', form.settings.closedMessage || labels.closed)
}

async function readInput(c: Context): Promise<SubmitInput> {
  let raw: unknown
  try {
    raw = JSON.parse(await c.req.text())
  } catch {
    throw new ApiError(400, 'invalid_json', 'The request body must be JSON')
  }
  const parsed = submitInput.safeParse(raw)
  if (!parsed.success) {
    throw new ApiError(400, 'invalid_request', 'This response could not be read. Reload the form and try again.', z.flattenError(parsed.error).fieldErrors as Record<string, string[]>)
  }
  return parsed.data
}

/** Answers without signature data URLs must stay under 256 KB. */
function assertAnswerSize(answers: Record<string, unknown>): void {
  const withoutSignatures = JSON.stringify(answers, (_k, v) => (isSignatureDataUrl(v) ? '' : v))
  if (Buffer.byteLength(withoutSignatures) > MAX_ANSWERS_BYTES) throw new ApiError(413, 'payload_too_large', 'That response is too large. Shorten the longest answers and try again.')
}

/**
 * The current published version, or the one it replaced if that happened under 24 hours ago
 * (a respondent mid-way through when the owner republished). Anything older: reload.
 */
async function versionFor(form: LoadedForm, versionId: string): Promise<{ definition: FormDefinition; version: number }> {
  if (versionId === form.versionId) return { definition: form.definition, version: form.version }
  const [row] = await sql<{ definition: unknown; version: number }[]>`
    SELECT prev.definition, prev.version
    FROM form_versions prev
    JOIN form_versions cur ON cur.id = ${form.versionId} AND cur.form_id = prev.form_id
    WHERE prev.id = ${versionId} AND prev.form_id = ${form.id}
      AND prev.version = cur.version - 1
      AND cur.published_at > now() - make_interval(secs => ${PREVIOUS_VERSION_GRACE_MS / 1000})
  `
  const def = row && formDefinition.safeParse(row.definition)
  if (!row || !def || !def.success) throw new ApiError(409, 'version_unknown', 'This form has changed. Reload the page to see the latest version.')
  return { definition: def.data, version: row.version }
}

function cleanTtc(ttc: Record<string, number> | undefined, answers: Record<string, unknown>): Record<string, number> | null {
  if (!ttc) return null
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(ttc)) {
    if (Object.hasOwn(answers, k) && Number.isFinite(v) && v >= 0) out[k] = Math.min(Math.round(v), MAX_TTC_MS)
  }
  return Object.keys(out).length ? out : null
}

/**
 * Signature answers arrive only as PNG data URLs (the answer schema rejects anything else).
 * Decode them all and check the PNG signature first, so a bad one costs no upload; then store each.
 */
async function uploadSignatures(def: FormDefinition, answers: Record<string, unknown>, formId: string, labels: Labels): Promise<void> {
  const pending: { id: string; bytes: Buffer }[] = []
  for (const f of def.fields) {
    if (f.type !== 'signature' || answers[f.id] === undefined) continue
    const v = answers[f.id] as { url?: unknown }
    const bytes = isSignatureDataUrl(v.url) ? Buffer.from(signatureBytes(v.url)) : null
    if (!bytes || bytes.length <= PNG_MAGIC.length || !bytes.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) {
      throw new ApiError(422, 'validation_failed', labels.errorSummary, { [f.id]: [labels.invalidSignature] })
    }
    pending.push({ id: f.id, bytes })
  }
  for (const { id, bytes } of pending) {
    try {
      const { url } = await storeBuffer(bytes, 'image/png', `intelform/signatures/${formId}/${randomUUID()}.png`)
      answers[id] = { url }
    } catch (err) {
      logger.error({ err }, 'signature upload failed')
      throw new ApiError(502, 'storage_failed', 'Your signature couldn’t be saved. Try again in a moment.')
    }
  }
}

/** Still live and under the cap, and (one per email) not a known address. Not locked: step 9 is exact. */
async function preCheck(form: LoadedForm, answers: Record<string, unknown>, labels: Labels): Promise<void> {
  const [row] = await sql<{ status: LoadedForm['status']; response_count: number; settings: unknown }[]>`
    SELECT status, response_count, settings FROM forms WHERE id = ${form.id}
  `
  if (!row) throw closedError(form, labels)
  const fresh = formSettings.parse(row.settings)
  if (isClosed({ status: row.status, responseCount: row.response_count, settings: fresh })) throw closedError(form, labels)
  const fieldId = fresh.onePerEmail ? fresh.onePerEmailFieldId : null
  const email = fieldId ? answers[fieldId] : undefined
  if (fieldId && typeof email === 'string' && email) {
    const [dupe] = await sql`SELECT 1 FROM responses WHERE form_id = ${form.id} AND answers @> ${sql.json({ [fieldId]: email })} LIMIT 1`
    if (dupe) throw new ApiError(422, 'validation_failed', labels.alreadyResponded, { [fieldId]: [labels.alreadyResponded] })
  }
}

export async function handleSubmit(c: Context, slug: string): Promise<SubmitResponse> {
  // 1. Body
  const input = await readInput(c)
  assertAnswerSize(input.answers)

  // 2. Form state
  const form = await requireForm(slug)
  const labels = resolveLabels({ ...form.definition.labels, ...form.settings.labels })
  if (isClosed(form)) throw closedError(form, labels)
  const hash = form.settings.passwordHash
  if (hash && !checkUnlockToken(input.unlockToken, form.id, hash)) {
    throw new ApiError(401, 'locked', 'Enter the form password again, then submit.')
  }

  // 3. Rate limit, before anything that costs (Turnstile, uploads)
  await rateLimit(`respond:${ipKey(c)}:${form.id}`, SUBMIT_RATE_LIMIT, 60, 'You sent several responses in a row. Wait a minute and try again.')

  // 4. Honeypot and minimum time: pretend it worked, keep nothing.
  const renderedAt = readRenderToken(input.renderToken, form.id)
  if ((input.hp ?? '') !== '' || renderedAt === null || Date.now() - renderedAt < MIN_FILL_MS) {
    logger.info({ formId: form.id, honeypot: !!input.hp, renderedAt }, 'submission dropped by spam checks')
    return { ok: true }
  }

  // 5. Validate against the version that was rendered (consent stamped with server time and version)
  const version = await versionFor(form, input.formVersionId)
  const def = version.definition
  const now = new Date()
  const result = validateSubmission(def, input.answers, { labels: form.settings.labels, context: { now, formVersion: version.version }, hidden: 'reject' })
  if (!result.ok) throw new ApiError(422, 'validation_failed', labels.errorSummary, fieldErrors(result.errors))
  const answers = result.answers

  // 6. Turnstile (after validation: a token works only once)
  const turnstile = await turnstileFor(form.settings)
  if (turnstile) await verifyTurnstile(turnstile.secret, input.turnstileToken, clientIp(c))

  // 7. One response per browser (soft limit)
  const browserHash = input.browserToken ? hashBrowserToken(form.id, input.browserToken) : null
  if (form.settings.onePerBrowser && browserHash) {
    const [seen] = await sql`SELECT 1 FROM responses WHERE form_id = ${form.id} AND browser_token = ${browserHash} LIMIT 1`
    if (seen) throw new ApiError(409, 'already_responded', labels.alreadyResponded)
  }

  // 8. Cheap checks the transaction repeats exactly, so a doomed submit uploads nothing.
  await preCheck(form, answers, labels)
  await uploadSignatures(def, answers, form.id, labels)

  // 9. One transaction
  const meta = requestMeta(c)
  const startedAt = input.startedAt && input.startedAt <= now.getTime() && now.getTime() - input.startedAt < MAX_STARTED_AGO_MS ? new Date(input.startedAt) : null
  const durationMs = startedAt ? now.getTime() - startedAt.getTime() : null
  const ttc = cleanTtc(input.ttc, answers)
  const search = buildSearchText(def.fields, answers)

  await sql.begin(async (tx) => {
    const s = form.settings
    const email = s.onePerEmail && s.onePerEmailFieldId ? answers[s.onePerEmailFieldId] : undefined
    if (typeof email === 'string' && email) {
      // Serialises submits for this email on this form, so two at once can't both pass.
      await tx`SELECT pg_advisory_xact_lock(hashtext(${form.id + '|' + email}))`
      const [dupe] = await tx`
        SELECT 1 FROM responses WHERE form_id = ${form.id} AND answers @> ${tx.json({ [s.onePerEmailFieldId!]: email })} LIMIT 1
      `
      if (dupe) throw new ApiError(422, 'validation_failed', labels.alreadyResponded, { [s.onePerEmailFieldId!]: [labels.alreadyResponded] })
    }

    // The counter update locks the form row: the cap check below is exact.
    const [counted] = await tx<{ response_count: number; settings: unknown }[]>`
      UPDATE forms SET response_count = response_count + 1, last_response_at = now()
      WHERE id = ${form.id} AND status = 'live'
      RETURNING response_count, settings
    `
    if (!counted) throw closedError(form, labels)
    const fresh = formSettings.parse(counted.settings)
    if (fresh.closeAt && Date.parse(fresh.closeAt) <= now.getTime()) throw closedError(form, labels)
    if (fresh.responseCap !== null && counted.response_count > fresh.responseCap) throw closedError(form, labels)

    const [row] = await tx<{ id: string; submitted_at: Date }[]>`
      INSERT INTO responses (form_id, form_version_id, answers, started_at, duration_ms, ttc, ip_hash, country, device, browser, browser_token, search_text)
      VALUES (${form.id}, ${input.formVersionId}, ${tx.json(answers as never)}, ${startedAt}, ${durationMs}, ${ttc ? tx.json(ttc) : null},
              ${meta.ipHash}, ${meta.country}, ${meta.device}, ${meta.browser}, ${browserHash}, ${search})
      RETURNING id, submitted_at
    `
    if (fresh.responseCap !== null && counted.response_count >= fresh.responseCap) {
      await tx`UPDATE forms SET status = 'closed', updated_at = now() WHERE id = ${form.id}`
    }
    await queueResponseJobs(tx, { ...form, settings: fresh }, def, {
      id: row.id,
      submittedAt: row.submitted_at,
      versionId: input.formVersionId,
      version: version.version,
      answers,
    })
  })

  // 10. Reply
  const s = form.settings
  if (s.afterSubmit === 'redirect' && s.redirectUrl) {
    return { ok: true, redirectUrl: redirectWithAnswers(s.redirectUrl, def, answers, s.redirectAppendAnswers) }
  }
  return { ok: true }
}
