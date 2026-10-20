import { OTHER_OPTION_ID, VALUELESS_OPS, type Condition, type ConditionOp, type FormDefinition, type LogicRule } from '@shared/form/definition'
import { countryName, formatDate, formatTime } from '@shared/form/types/registry'
import { fieldName } from './ops'

/** Operator words for the logic editor and rule sentences (PRD Logic table). */
export const OP_LABEL: Record<ConditionOp, string> = {
  is: 'is',
  is_not: 'is not',
  contains: 'contains',
  not_contains: 'does not contain',
  is_empty: 'is empty',
  is_not_empty: 'is not empty',
  eq: '=',
  neq: '≠',
  gt: '>',
  gte: '≥',
  lt: '<',
  lte: '≤',
  before: 'is before',
  after: 'is after',
  includes: 'includes',
  not_includes: 'does not include',
  is_yes: 'is yes',
  is_no: 'is no',
}

/** Longer words for the operator menu, where symbols alone are unclear to screen readers. */
export const OP_MENU_LABEL: Record<ConditionOp, string> = {
  ...OP_LABEL,
  eq: '= equals',
  neq: '≠ does not equal',
  gt: '> greater than',
  gte: '≥ at least',
  lt: '< less than',
  lte: '≤ at most',
}

export function conditionValueText(def: FormDefinition, c: Condition): string {
  const src = def.fields.find((f) => f.id === c.field)
  const v = c.value
  if (v === undefined || v === '') return '…'
  if (!src) return String(v)
  switch (src.type) {
    case 'single_choice':
    case 'multiple_choice':
    case 'dropdown':
    case 'picture_choice': {
      if (v === OTHER_OPTION_ID) return '“Other”'
      const o = src.props.options.find((x) => x.id === v)
      return o ? `“${o.label || 'Untitled option'}”` : '“deleted option”'
    }
    case 'country':
      return typeof v === 'string' ? countryName(v) : String(v)
    case 'date':
      return typeof v === 'string' ? formatDate(v, src.props.format) : String(v)
    case 'time':
      return typeof v === 'string' ? formatTime(v, src.props.hourCycle) : String(v)
    case 'number':
    case 'rating':
    case 'nps':
      return String(v)
    default:
      return `“${String(v)}”`
  }
}

export function describeCondition(def: FormDefinition, c: Condition): string {
  const src = def.fields.find((f) => f.id === c.field)
  const name = src ? fieldName(def, src) : 'a deleted question'
  if (VALUELESS_OPS.includes(c.op)) return `${name} ${OP_LABEL[c.op]}`
  return `${name} ${OP_LABEL[c.op]} ${conditionValueText(def, c)}`
}

/** "Shown when NPS ≤ 6", "Hidden when Email is empty or Name is empty". */
export function describeRule(def: FormDefinition, rule: LogicRule): string {
  const verb = rule.action === 'show' ? 'Shown when' : 'Hidden when'
  const joiner = rule.match === 'all' ? ' and ' : ' or '
  return `${verb} ${rule.conditions.map((c) => describeCondition(def, c)).join(joiner)}`
}
