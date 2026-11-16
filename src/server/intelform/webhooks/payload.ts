import type { FormDefinition, FormField } from '../../../lib/intelform/form/definition'
import { interpolate } from '../../../lib/intelform/form/logic'
import { absoluteUrl, answeredFields } from '../notify/answers'

/**
 * The webhook body (PRD): form id, version, response id, submitted_at, and the answers keyed by
 * field id with label and type. Signature answers carry an absolute URL.
 */
export interface WebhookAnswer {
  label: string
  type: string
  value: unknown
}

export interface WebhookPayload {
  type: 'response.created' | 'response.test'
  test?: true
  form_id: string
  form_title: string
  form_version: number | null
  response_id: string | null
  submitted_at: string
  answers: Record<string, WebhookAnswer>
}

export interface PayloadForm {
  id: string
  title: string
}

export interface PayloadResponse {
  id: string
  submittedAt: Date
  version: number
  answers: Record<string, unknown>
}

export function webhookPayload(form: PayloadForm, def: FormDefinition, r: PayloadResponse, origin: string | null): WebhookPayload {
  const answers: Record<string, WebhookAnswer> = {}
  for (const f of answeredFields(def, r.answers)) {
    let value = r.answers[f.id]
    if (f.type === 'signature' && value && typeof value === 'object') {
      value = { url: absoluteUrl(String((value as { url?: unknown }).url ?? ''), origin) }
    }
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

/**
 * "Send test": the same keys and answer shapes as a real delivery, with sample answers, so a
 * receiver built against a test also handles real responses (legacy builder testPayload).
 */
export function sampleWebhookPayload(form: PayloadForm & { version: number | null }, def: Pick<FormDefinition, 'fields'> | null): WebhookPayload {
  const answers: Record<string, WebhookAnswer> = {}
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
