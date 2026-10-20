import type { FormDefinition, FormField } from '../../shared/form/definition'
import { answerToCsv } from '../../shared/form/csv'
import { coreRegistry } from '../../shared/form/types/registry'

/** Human-readable answer text, one line per CSV cell (emails, redirect parameters). */
export function answerText(field: FormField, value: unknown): string {
  return answerToCsv(field, value).filter((c) => c !== '').join(', ')
}

/** Stored fields with an answer, in form order. */
export function answeredFields(def: FormDefinition, answers: Record<string, unknown>): FormField[] {
  return def.fields.filter((f) => coreRegistry[f.type].stores && answers[f.id] !== undefined)
}

/**
 * Redirect after submit, with answers appended as query parameters (keyed by field id) when
 * that setting is on. Signatures are never appended.
 */
export function redirectWithAnswers(base: string, def: FormDefinition, answers: Record<string, unknown>, append: boolean): string {
  const url = new URL(base)
  if (append) {
    for (const f of answeredFields(def, answers)) {
      if (f.type === 'signature') continue
      url.searchParams.set(f.id, answerText(f, answers[f.id]))
    }
  }
  return url.toString()
}
