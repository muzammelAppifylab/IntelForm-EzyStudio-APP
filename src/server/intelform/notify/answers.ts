import { answerToCsv } from '../../../lib/intelform/form/csv'
import { formDefinition, type FormDefinition, type FormField } from '../../../lib/intelform/form/definition'
import { interpolate } from '../../../lib/intelform/form/logic'
import { coreRegistry } from '../../../lib/intelform/form/types/registry'

/**
 * Answer helpers for the emails and the webhook payload (legacy server/respondent/answers.ts).
 * Pure: no database, no platform calls.
 */

/** Human-readable answer text, one line per CSV cell (emails, redirect parameters). */
export function answerText(field: FormField, value: unknown): string {
  return answerToCsv(field, value)
    .filter((c) => c !== '')
    .join(', ')
}

/** Stored fields with an answer, in form order. */
export function answeredFields(def: Pick<FormDefinition, 'fields'>, answers: Record<string, unknown>): FormField[] {
  return def.fields.filter((f) => coreRegistry[f.type]?.stores && answers[f.id] !== undefined)
}

/** A relative link (`/__platform/files/…`) made absolute on the site's own address; others unchanged. */
export function absoluteUrl(url: string, origin: string | null): string {
  return url.startsWith('/') && origin ? origin.replace(/\/+$/, '') + url : url
}

function signatureUrlOf(value: unknown): string {
  return value && typeof value === 'object' && typeof (value as { url?: unknown }).url === 'string' ? (value as { url: string }).url : ''
}

/** The answers as plain text: "Label\nanswer" blocks, blank line between them. */
export function answersAsText(def: FormDefinition, answers: Record<string, unknown>, origin: string | null): string {
  return answeredFields(def, answers)
    .map((f) => {
      const label = interpolate(f.label, def, answers).trim() || 'Untitled question'
      const v = f.type === 'signature' ? absoluteUrl(signatureUrlOf(answers[f.id]), origin) : answerText(f, answers[f.id])
      return `${label}\n${v}`
    })
    .join('\n\n')
}

/**
 * A stored definition (form_versions.definition) as a FormDefinition. Stored rows passed the
 * schema when they were published; a row that no longer parses still yields its fields when
 * they look like fields, so a notification is never lost to a schema tweak.
 */
export function readDefinition(json: unknown): FormDefinition {
  const parsed = formDefinition.safeParse(json)
  if (parsed.success) return parsed.data
  const raw = (json && typeof json === 'object' ? json : {}) as Partial<FormDefinition>
  const fields = Array.isArray(raw.fields)
    ? raw.fields.filter(
        (f): f is FormField =>
          !!f && typeof f === 'object' && typeof f.id === 'string' && typeof f.type === 'string' && f.type in coreRegistry,
      )
    : []
  return { ...(raw as FormDefinition), fields }
}

/** answers jsonb → a plain object (anything else is no answers). */
export function readAnswers(json: unknown): Record<string, unknown> {
  return json && typeof json === 'object' && !Array.isArray(json) ? (json as Record<string, unknown>) : {}
}
