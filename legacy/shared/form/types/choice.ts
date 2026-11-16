import * as z from 'zod/mini'
import {
  BOOL_OPS,
  CHOICE_OPS,
  MULTI_OPS,
  base,
  choiceAnswerSchema,
  choiceOption,
  defaultOptions,
  defineType,
  isChoiceAnswer,
  migrateOptions,
  optionLabel,
  optionList,
  pictureOption,
  str,
  type ChoiceAnswer,
  type CoreField,
} from './common'

/*
 * Answer encoding for every choice type (see ChoiceAnswer in common.ts):
 *   single_choice, dropdown         { option: "o_a1" } | { option: "o_other", other: "text" }
 *   multiple_choice, picture_choice [{ option: "o_a1" }, { option: "o_other", other: "text" }]
 *   yes_no                          true | false
 * Logic condition values for choices are option ids ("o_a1", or "o_other" for Other).
 */

function choiceOps(op: (typeof CHOICE_OPS)[number] | string, a: unknown, v: unknown): boolean {
  const empty = !isChoiceAnswer(a)
  if (op === 'is_empty') return empty
  if (op === 'is_not_empty') return !empty
  if (empty) return false
  if (op === 'is') return a.option === v
  if (op === 'is_not') return a.option !== v
  return false
}

function choiceArray(v: unknown): ChoiceAnswer[] {
  return Array.isArray(v) ? v.filter(isChoiceAnswer) : []
}

function multiOps(op: string, a: unknown, v: unknown): boolean {
  const list = choiceArray(a)
  if (op === 'is_empty') return list.length === 0
  if (op === 'is_not_empty') return list.length > 0
  if (list.length === 0) return false
  const has = list.some((x) => x.option === v)
  if (op === 'includes') return has
  if (op === 'not_includes') return !has
  return false
}

function multiAnswer(
  ids: Set<string>,
  allowOther: boolean,
  min: number | null,
  max: number | null,
): z.ZodMiniType<ChoiceAnswer[]> {
  const checks: z.core.$ZodCheck<ChoiceAnswer[]>[] = [
    z.maxLength(200, 'invalidChoice'),
    z.refine((list: ChoiceAnswer[]) => new Set(list.map((x) => x.option)).size === list.length, 'invalidChoice'),
  ]
  if (min) checks.push(z.refine((l: ChoiceAnswer[]) => l.length >= min, `chooseAtLeast:${min}`))
  if (max) checks.push(z.refine((l: ChoiceAnswer[]) => l.length <= max, `chooseAtMost:${max}`))
  return z.array(choiceAnswerSchema(ids, allowOther), { error: 'invalidChoice' }).check(...checks)
}

const def = z._default
const bool = (value: boolean) => def(z.boolean(), value)
const selections = () => def(z.nullable(z.number().check(z.int(), z.gte(1), z.lte(200))), null)

type OptionField = CoreField<{ options: { id: string; label: string }[] }>

function labelsOf(v: unknown, field: OptionField): string[] {
  return choiceArray(v).map((a) => optionLabel(field.props.options, a))
}

/** Choice → choice keeps options (and "Other", randomize where both have them). */
function migrateChoice(old: Record<string, unknown>) {
  return {
    ...migrateOptions(old),
    ...(typeof old.randomize === 'boolean' && { randomize: old.randomize }),
  }
}

// ------------------------------------------------------------------ Single choice

const singleChoiceProps = z.object({
  options: optionList(choiceOption, () => defaultOptions(2)),
  /** Adds an "Other" option with a text box; its id is OTHER_OPTION_ID. */
  other: bool(false),
  randomize: bool(false),
  orientation: def(z.enum(['vertical', 'horizontal']), 'vertical'),
})

export const single_choice = defineType({
  ...base('single_choice'),
  props: singleChoiceProps,
  defaultProps: () => singleChoiceProps.parse({}),
  answer: (field) => choiceAnswerSchema(new Set(field.props.options.map((o) => o.id)), field.props.other),
  isEmpty: (v) => !isChoiceAnswer(v),
  operators: CHOICE_OPS,
  evaluate: (op, a, v) => choiceOps(op, a, v),
  pipeParts: () => [],
  pipe: (v, _p, field) => (isChoiceAnswer(v) ? optionLabel(field.props.options, v) : ''),
  csvColumns: () => [''],
  csv: (v, field) => [isChoiceAnswer(v) ? optionLabel(field.props.options, v) : ''],
  migrateProps: (_from, old) => ({
    ...migrateChoice(old),
    ...(typeof old.other === 'boolean' && { other: old.other }),
  }),
})

// ------------------------------------------------------------------ Multiple choice

const multipleChoiceProps = z.extend(singleChoiceProps, {
  minSelections: selections(),
  maxSelections: selections(),
})

export const multiple_choice = defineType({
  ...base('multiple_choice'),
  props: multipleChoiceProps,
  defaultProps: () => multipleChoiceProps.parse({}),
  answer: (field) =>
    multiAnswer(
      new Set(field.props.options.map((o) => o.id)),
      field.props.other,
      field.props.minSelections,
      field.props.maxSelections,
    ),
  isEmpty: (v) => choiceArray(v).length === 0,
  operators: MULTI_OPS,
  evaluate: (op, a, v) => multiOps(op, a, v),
  pipeParts: () => [],
  pipe: (v, _p, field) => labelsOf(v, field).join(', '),
  csvColumns: () => [''],
  csv: (v, field) => [labelsOf(v, field).join('; ')],
  migrateProps: (_from, old) => ({
    ...migrateChoice(old),
    ...(typeof old.other === 'boolean' && { other: old.other }),
    ...(typeof old.minSelections === 'number' && { minSelections: old.minSelections }),
    ...(typeof old.maxSelections === 'number' && { maxSelections: old.maxSelections }),
  }),
})

// ------------------------------------------------------------------ Dropdown

const dropdownProps = z.object({
  options: optionList(choiceOption, () => defaultOptions(3)),
  searchable: bool(true),
  randomize: bool(false),
})

export const dropdown = defineType({
  ...base('dropdown'),
  props: dropdownProps,
  defaultProps: () => dropdownProps.parse({}),
  answer: (field) => choiceAnswerSchema(new Set(field.props.options.map((o) => o.id)), false),
  isEmpty: (v) => !isChoiceAnswer(v),
  operators: CHOICE_OPS,
  evaluate: (op, a, v) => choiceOps(op, a, v),
  pipeParts: () => [],
  pipe: (v, _p, field) => (isChoiceAnswer(v) ? optionLabel(field.props.options, v) : ''),
  csvColumns: () => [''],
  csv: (v, field) => [isChoiceAnswer(v) ? optionLabel(field.props.options, v) : ''],
  migrateProps: (_from, old) => migrateChoice(old),
})

// ------------------------------------------------------------------ Yes / No: boolean

const yesNoProps = z.object({
  yesLabel: def(z.string().check(z.maxLength(40)), 'Yes'),
  noLabel: def(z.string().check(z.maxLength(40)), 'No'),
})

export const yes_no = defineType({
  ...base('yes_no'),
  props: yesNoProps,
  defaultProps: () => yesNoProps.parse({}),
  answer: () => z.boolean({ error: 'invalidChoice' }),
  isEmpty: (v) => typeof v !== 'boolean',
  operators: BOOL_OPS,
  evaluate: (op, a) => (op === 'is_yes' ? a === true : op === 'is_no' ? a === false : false),
  pipeParts: () => [],
  pipe: (v, _p, field) => (v === true ? field.props.yesLabel : v === false ? field.props.noLabel : ''),
  csvColumns: () => [''],
  csv: (v, field) => [v === true ? field.props.yesLabel : v === false ? field.props.noLabel : ''],
  migrateProps: (from, old) =>
    from === 'yes_no' ? { yesLabel: str(old.yesLabel) || 'Yes', noLabel: str(old.noLabel) || 'No' } : {},
})

// ------------------------------------------------------------------ Picture choice: always an array

const pictureChoiceProps = z.object({
  options: optionList(pictureOption, () =>
    defaultOptions(2).map((o) => ({ ...o, imageUrl: null })),
  ),
  /** false: one answer (array of length 1). true: several. */
  multiple: bool(false),
  columns: def(z.number().check(z.int(), z.gte(2), z.lte(4)), 2),
  minSelections: selections(),
  maxSelections: selections(),
  randomize: bool(false),
})

export const picture_choice = defineType({
  ...base('picture_choice'),
  props: pictureChoiceProps,
  defaultProps: () => pictureChoiceProps.parse({}),
  answer(field) {
    const ids = new Set(field.props.options.map((o) => o.id))
    return field.props.multiple
      ? multiAnswer(ids, false, field.props.minSelections, field.props.maxSelections)
      : multiAnswer(ids, false, null, 1)
  },
  isEmpty: (v) => choiceArray(v).length === 0,
  operators: MULTI_OPS,
  evaluate: (op, a, v) => multiOps(op, a, v),
  pipeParts: () => [],
  pipe: (v, _p, field) => labelsOf(v, field).join(', '),
  csvColumns: () => [''],
  csv: (v, field) => [labelsOf(v, field).join('; ')],
  migrateProps(from, old) {
    const out: Record<string, unknown> = { ...migrateChoice(old) }
    if (from === 'picture_choice' && Array.isArray(old.options)) {
      const parsed = pictureChoiceProps.shape.options.safeParse(old.options)
      if (parsed.success) out.options = parsed.data
    } else if (Array.isArray(out.options)) {
      out.options = (out.options as { id: string; label: string }[]).map((o) => ({ ...o, imageUrl: null }))
    }
    if (from === 'multiple_choice') out.multiple = true
    if (typeof old.multiple === 'boolean') out.multiple = old.multiple
    return out
  },
})

