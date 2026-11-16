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

// What a mail client may turn into a link. Dots include the ideographic and full-width forms
// that browsers read as dots in host names.
const DOT = String.raw`[.。．｡]`
const LABEL = String.raw`[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?`
const HOST = String.raw`${LABEL}(?:${DOT}${LABEL})*${DOT}(?:\p{L}{2,63}|xn--[a-z0-9-]{1,59})`
const IPV4 = String.raw`\d{1,3}(?:${DOT}\d{1,3}){3}`
/** A port, path, query or fragment after a host. */
const REST = String.raw`(?:[:/?#\\]\S*)?`
const LINK_RE = new RegExp(
  [
    // A plain email address (nothing link-like after it) is kept: "We'll reply to {f_email}".
    String.raw`(?<email>(?<![\p{L}\p{N}._%+\-])[\p{L}\p{N}._%+\-]+@${HOST}(?!${DOT}?[\p{L}\p{N}/?#:\\@\-]))`,
    // Any scheme://…, and the schemes that link without slashes.
    String.raw`\b[a-z][a-z0-9+.\-]{0,30}:\/\/\S*`,
    String.raw`\b(?:mailto|tel|sms|callto|facetime|javascript|vbscript|data|file|ftp|news|nntp|irc|xmpp|sip|skype|whatsapp|tg|magnet):\S+`,
    String.raw`\bwww\d{0,3}${DOT}\S+`,
    String.raw`\[[0-9a-f:.]*:[0-9a-f:.]*\]${REST}`,
    String.raw`(?<![\p{L}\p{N}.\-])${IPV4}(?!\p{N})${REST}`,
    String.raw`(?<![\p{L}\p{N}._%+\-])${HOST}(?![\p{L}\p{N}\-])${REST}`,
  ].join('|'),
  'giu',
)
/** Invisible characters that could hide a link from the patterns above (zero-width, bidi controls, soft hyphen). */
const INVISIBLE_RE = /[­​‌‎‏‪-‮⁠-⁤⁦-⁩﻿]/g

/** One answer with everything link-like removed; a plain email address stays. */
export function stripLinks(text: string): string {
  return text
    .replace(INVISIBLE_RE, '')
    .replace(LINK_RE, (match: string, ...rest: unknown[]) => ((rest.at(-1) as { email?: string }).email ? match : ''))
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

/**
 * Answers as the confirmation email may pipe them: every URL, bare domain ("evil.com/login",
 * "www.evil.com"), IP address and mailto:/tel: link removed from text, so a respondent can't
 * make the form send a link to an address they typed. Only answers pass through here; the
 * form owner's own subject and body are left alone.
 */
export function withoutLinks(v: unknown): unknown {
  if (typeof v === 'string') return stripLinks(v)
  if (Array.isArray(v)) return v.map(withoutLinks)
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, withoutLinks(x)]))
  return v
}

/** True while this form is under its hourly confirmation cap; over it, the email is skipped. */
async function confirmationAllowed(tx: TransactionSql, formId: string): Promise<boolean> {
  try {
    // On tx: the submit holds the form's row lock, so a second pool connection could starve the pool.
    await rateLimit(`confirm:${formId}`, CONFIRM_EMAIL_LIMIT, 3600, undefined, tx)
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
    if (typeof to === 'string' && EMAIL_RE.test(to) && (await confirmationAllowed(tx, form.id))) {
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
