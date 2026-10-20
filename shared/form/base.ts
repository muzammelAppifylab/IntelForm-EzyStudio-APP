import * as z from 'zod/mini'

/**
 * Low-level building blocks shared by the definition schema and the field-type registry.
 * Kept separate from definition.ts so the registry can import them without a cycle.
 * Everything here is re-exported from definition.ts; import from there, except in the
 * respondent bundle, which imports this file directly (zod/mini, no definition schema).
 */

/** Stable short ids: "f_" + 4–12 lowercase letters/digits for fields, "o_" for options. */
export const fieldId = z.string().check(z.regex(/^f_[a-z0-9]{4,12}$/))
export const optionId = z.string().check(z.regex(/^o_[a-z0-9]{2,12}$/))

/**
 * Reserved option id for the "Other" choice (single and multiple choice). Generated option
 * ids are 6 characters long, so they never collide with it.
 */
export const OTHER_OPTION_ID = 'o_other'

export const CONDITION_OPS = [
  'is',
  'is_not',
  'contains',
  'not_contains',
  'is_empty',
  'is_not_empty',
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'before',
  'after',
  'includes',
  'not_includes',
  'is_yes',
  'is_no',
] as const
export type ConditionOp = (typeof CONDITION_OPS)[number]

/** Operators that take no comparison value. */
export const VALUELESS_OPS: readonly ConditionOp[] = ['is_empty', 'is_not_empty', 'is_yes', 'is_no']

export const condition = z.object({
  field: fieldId,
  op: z.enum(CONDITION_OPS),
  value: z.optional(z.union([z.string().check(z.maxLength(500)), z.number(), z.boolean()])),
})

/** Show/hide rule on a field: conditions joined by ALL or ANY, no nesting. */
export const logicRule = z.object({
  action: z.enum(['show', 'hide']),
  match: z.enum(['all', 'any']),
  conditions: z.array(condition).check(z.minLength(1), z.maxLength(20)),
})

export type Condition = z.infer<typeof condition>
export type LogicRule = z.infer<typeof logicRule>

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

/** Unbiased random string from ID_ALPHABET; crypto.getRandomValues works in Node 22 and browsers. */
function randomId(length: number): string {
  let out = ''
  const buf = new Uint8Array(length * 2)
  while (out.length < length) {
    globalThis.crypto.getRandomValues(buf)
    for (const b of buf) {
      // 252 = 36 * 7: drop the top bytes so every character is equally likely.
      if (b < 252) out += ID_ALPHABET[b % 36]
      if (out.length === length) break
    }
  }
  return out
}

/** A new permanent field id, e.g. "f_k3x9a2qm". */
export function newFieldId(): string {
  return `f_${randomId(8)}`
}

/** A new permanent option id, e.g. "o_7hq2xa". Never equals OTHER_OPTION_ID. */
export function newOptionId(): string {
  return `o_${randomId(6)}`
}
