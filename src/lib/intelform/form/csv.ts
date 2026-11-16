import type { FormField } from './definition'
import { coreRegistry } from './types/registry'

/**
 * Answer → CSV cells (PRD "Responses → CSV export"). One column per field, except a split
 * name (first, last) and an address (one per enabled line). Multiple choice is joined with
 * "; ", a signature is its URL, choices are option labels ("Other" answers show their text).
 * Cells are plain text: CSV escaping, formula guarding and the BOM are server/lib/csv.ts.
 * Section breaks have no columns.
 */

/** Column headers for one field, e.g. ["Your name (first name)", "Your name (last name)"]. */
export function csvHeaders(field: FormField): string[] {
  const label = field.label.trim() || 'Untitled question'
  return coreRegistry[field.type].csvColumns(field).map((suffix) => (suffix ? `${label} (${suffix})` : label))
}

/** Cells for one answer; always the same length as csvHeaders(field). */
export function answerToCsv(field: FormField, value: unknown): string[] {
  const core = coreRegistry[field.type]
  const width = core.csvColumns(field).length
  if (value === undefined || value === null || core.isEmpty(value)) return Array.from({ length: width }, () => '')
  try {
    const cells = core.csv(value, field)
    return cells.length === width ? cells : [...cells, ...Array.from({ length: width }, () => '')].slice(0, width)
  } catch {
    return Array.from({ length: width }, () => '')
  }
}

/** Headers for a whole form (fields in order). */
export function csvHeadersFor(fields: readonly FormField[]): string[] {
  return fields.flatMap(csvHeaders)
}

/** One response row (fields in order). */
export function csvRowFor(fields: readonly FormField[], answers: Record<string, unknown>): string[] {
  return fields.flatMap((f) => answerToCsv(f, answers[f.id]))
}
