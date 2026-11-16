import { answerToCsv } from '../../../lib/intelform/form/csv'
import { formDefinition, type FormDefinition, type FormField } from '../../../lib/intelform/form/definition'
import { interpolate } from '../../../lib/intelform/form/logic'
import { coreRegistry } from '../../../lib/intelform/form/types/registry'
import { signatureViewPath, storedSignatureFileId } from '../uploads/signatures'

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

/**
 * A signature answer as a link to the guarded view route (sign-in and site:response:read
 * needed; the file itself is private), or '' when it holds no stored file.
 */
export function signatureLinkText(value: unknown, responseId: string, fieldId: string, origin: string | null): string {
  return storedSignatureFileId(value) ? absoluteUrl(signatureViewPath(responseId, fieldId), origin) : ''
}

/** The answers as plain text: "Label\nanswer" blocks, blank line between them. */
export function answersAsText(def: FormDefinition, answers: Record<string, unknown>, origin: string | null, responseId = ''): string {
  return answeredFields(def, answers)
    .map((f) => {
      const label = interpolate(f.label, def, answers).trim() || 'Untitled question'
      const v = f.type === 'signature' ? signatureLinkText(answers[f.id], responseId, f.id, origin) : answerText(f, answers[f.id])
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
