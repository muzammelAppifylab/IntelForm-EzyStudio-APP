import type { FieldType } from '../field-types'
import type { FieldTypeCore } from './common'

/**
 * The field types loaded in this bundle, keyed by type. ./registry.ts fills it with every type
 * (the server, the builder: import '../logic' or './registry'); the respondent's bundle fills it
 * with the types a form uses (src/respondent/field-types.ts) before the form renders, so a public
 * form downloads only the schemas it needs.
 */
export const coreRegistry = {} as Record<FieldType, FieldTypeCore>

export function registerFieldTypes(types: Partial<Record<FieldType, FieldTypeCore>>): void {
  Object.assign(coreRegistry, types)
}
