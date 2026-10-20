import type { TransactionSql } from 'postgres'
import { interpolate } from '../../shared/form/logic'
import { EMAIL_RE } from '../../shared/form/types/registry'
import { env } from '../env'
import { queueEmail } from '../lib/email'
import { ApiError } from '../lib/errors'
import { logger } from '../lib/logger'
import { rateLimit } from '../lib/rate-limit'
import { queueWebhook, readWebhookConfig } from '../lib/webhooks'
import { answerText, answeredFields } from './answers'
import type { LoadedForm } from './load'

/**
 * Jobs a new response queues inside the submit transaction (outbox): the owner notification,
 * the respondent confirmation and the webhook. They run after commit, so the reply never waits.
 */
export interface SubmittedResponse {
  id: string
  submittedAt: Date
  versionId: string
  version: number
  answers: Record<string, unknown>
}

/** Confirmation emails per form per hour: a form can't be turned into a bulk mailer. */
export const CONFIRM_EMAIL_LIMIT = 200

const URL_RE = /\bhttps?:\/\/\S*/gi

/**
 * Answers as the confirmation email may pipe them: every http(s) URL removed from text, so a
 * respondent can't make the form send a link to an address they typed.
 */
export function withoutLinks(v: unknown): unknown {
  if (typeof v === 'string') return v.replace(URL_RE, '').replace(/[ \t]{2,}/g, ' ').trim()
  if (Array.isArray(v)) return v.map(withoutLinks)
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, withoutLinks(x)]))
  return v
}

/** True while this form is under its hourly confirmation cap; over it, the email is skipped. */
async function confirmationAllowed(formId: string): Promise<boolean> {
  try {
    await rateLimit(`confirm:${formId}`, CONFIRM_EMAIL_LIMIT, 3600)
    return true
  } catch (err) {
    if (err instanceof ApiError && err.status === 429) {
      logger.warn({ formId }, 'confirmation email skipped: hourly cap reached')
      return false
    }
    throw err
  }
}

const absolute = (url: string) => (url.startsWith('/') ? env.APP_URL + url : url)

/** PRD webhook payload: form id, version, response id, submitted_at, answers keyed by field id with label and type. */
export function webhookPayload(form: LoadedForm, def: LoadedForm['definition'], r: SubmittedResponse) {
  const answers: Record<string, { label: string; type: string; value: unknown }> = {}
  for (const f of answeredFields(def, r.answers)) {
    let value = r.answers[f.id]
    if (f.type === 'signature' && value && typeof value === 'object') value = { url: absolute(String((value as { url: string }).url)) }
    answers[f.id] = { label: interpolate(f.label, def, r.answers), type: f.type, value }
  }
  return {
    type: 'response.created',
    form_id: form.id,
    form_title: form.title,
    form_version: r.version,
    response_id: r.id,
    submitted_at: r.submittedAt.toISOString(),
    answers,
  }
}

function answersAsText(def: LoadedForm['definition'], answers: Record<string, unknown>): string {
  return answeredFields(def, answers)
    .map((f) => {
      const label = interpolate(f.label, def, answers).trim() || 'Untitled question'
      const v = f.type === 'signature' ? absolute(String((answers[f.id] as { url?: string })?.url ?? '')) : answerText(f, answers[f.id])
      return `${label}\n${v}`
    })
    .join('\n\n')
}

export async function queueResponseJobs(tx: TransactionSql, form: LoadedForm, def: LoadedForm['definition'], r: SubmittedResponse): Promise<void> {
  const s = form.settings

  if (s.notifyOnResponse) {
    const recipients = s.notifyRecipients.length
      ? await tx<{ email: string }[]>`SELECT email FROM users WHERE id = ANY(${s.notifyRecipients}::uuid[]) AND status = 'active'`
      : await tx<{ email: string }[]>`SELECT email FROM users WHERE role = 'owner' AND status = 'active'`
    if (recipients.length) {
      const link = `${env.APP_URL}/dashboard/forms/${form.id}/responses?response=${r.id}`
      await queueEmail(tx, {
        to: recipients.map((u) => u.email),
        subject: `New response: ${form.title}`,
        text: `${form.title} has a new response.\n\n${answersAsText(def, r.answers)}\n\nOpen it in IntelForm:\n${link}\n`,
      })
    }
  }

  if (s.confirmationEmail && s.confirmationEmailFieldId) {
    const to = r.answers[s.confirmationEmailFieldId]
    if (typeof to === 'string' && EMAIL_RE.test(to) && (await confirmationAllowed(form.id))) {
      const piped = withoutLinks(r.answers) as Record<string, unknown>
      await queueEmail(tx, {
        to,
        subject: interpolate(s.confirmationSubject, def, piped).replace(/[\r\n]+/g, ' ').trim() || form.title,
        text: interpolate(s.confirmationBody, def, piped),
      })
    }
  }

  if (readWebhookConfig(s).enabled) {
    await queueWebhook(tx, form.id, r.id, webhookPayload(form, def, r))
  }
}
