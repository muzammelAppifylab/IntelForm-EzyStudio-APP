/** Form constants with no schema library (the respondent's bundle reads these without zod). */

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
