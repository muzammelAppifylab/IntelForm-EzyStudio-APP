import {
  VALUELESS_OPS,
  type Condition,
  type ConditionOp,
  type FormDefinition,
  type FormField,
  type Layout,
} from '../../../../lib/intelform/form/definition';
import {lintLogic, type LogicIssue} from '../../../../lib/intelform/form/logic';
import {isSafeUrl} from '../../../../lib/intelform/form/safe-url';
import {coreRegistry} from '../../../../lib/intelform/form/types/registry';

/**
 * The settings panel's rules, kept free of React so they can be unit tested
 * (tests/intelform/builder-panels.test.ts). The panels in this folder only render them.
 */

/** A rule holds at most this many conditions (legacy LogicEditor). */
export const MAX_CONDITIONS = 20;

/** One line under each layout choice (Form settings → Layout). */
export const LAYOUT_HELP: Record<Layout, string> = {
  all_at_once: 'Every question on one scrolling page, one Submit button.',
  section_by_section: 'One page per section break, with Back, Next and a progress bar.',
  one_at_a_time: 'One question per screen, large type. Enter moves on.',
};

/** What the rule shows or hides, in words: a section break is a page. */
export const ruleSubject = (field: Pick<FormField, 'type'>): 'page' | 'question' =>
  field.type === 'section_break' ? 'page' : 'question';

/** "Question 3": the 1-based number among real questions (section breaks don't count). */
export function questionNumber(def: Pick<FormDefinition, 'fields'>, index: number): number {
  return def.fields.slice(0, index + 1).filter(f => f.type !== 'section_break').length;
}

/** Questions a rule on the field at `index` may use: earlier, storing an answer, comparable. */
export function logicSources(def: Pick<FormDefinition, 'fields'>, index: number): FormField[] {
  return def.fields.slice(0, index).filter(f => coreRegistry[f.type].stores && coreRegistry[f.type].operators.length > 0);
}

/** The operators a source question offers (empty for an unknown source). */
export const operatorsFor = (src: FormField | undefined): readonly ConditionOp[] =>
  src ? coreRegistry[src.type].operators : [];

/** A fresh condition on `src`: its first operator, no value yet. */
export function newCondition(src: FormField): Condition {
  return {field: src.id, op: coreRegistry[src.type].operators[0]!};
}

export const needsValue = (op: ConditionOp) => !VALUELESS_OPS.includes(op);

/**
 * The condition after picking another operator. The value survives when both the old and the
 * new operator take one ("contains" → "is"), and is dropped for "is empty" and the like.
 */
export function withOperator(c: Condition, op: ConditionOp): Condition {
  const keep = needsValue(op) && needsValue(c.op) && c.value !== undefined;
  return keep ? {field: c.field, op, value: c.value} : {field: c.field, op};
}

/** The condition with a new value; empty input removes the value instead of storing "". */
export function withValue(c: Condition, value: Condition['value']): Condition {
  const next: Condition = {field: c.field, op: c.op};
  if (value !== undefined && value !== '') next.value = value;
  return next;
}

/** Problems with the rule on one field, per condition (the warnings under the conditions). */
export function ruleIssues(def: FormDefinition, fieldId: string): LogicIssue[] {
  return lintLogic(def).filter(i => i.fieldId === fieldId && i.conditionIndex !== undefined);
}

/**
 * Why a condition's question is not in the picker: it moved below the field ("stray"), or it
 * was deleted. Null when the condition's question is a valid source.
 */
export function conditionProblem(
  def: FormDefinition,
  sources: readonly FormField[],
  c: Condition
): {kind: 'below'; field: FormField} | {kind: 'deleted'} | null {
  if (sources.some(f => f.id === c.field)) return null;
  const stray = def.fields.find(f => f.id === c.field);
  return stray ? {kind: 'below', field: stray} : {kind: 'deleted'};
}

/**
 * The end screen's button from what was typed: a valid button, `null` to remove a saved one,
 * or `undefined` when nothing should be written (incomplete input and nothing saved yet).
 */
export function endButtonFrom(
  label: string,
  url: string,
  hasSaved: boolean
): {label: string; url: string} | null | undefined {
  const l = label.trim();
  const u = url.trim();
  if (l && isSafeUrl(u)) return {label: l.slice(0, 40), url: u};
  return hasSaved ? null : undefined;
}

/** The error under the end screen's button link, or null. */
export const endButtonUrlError = (url: string): string | null =>
  url && !isSafeUrl(url.trim()) ? 'Enter a full link starting with https://' : null;

/**
 * A number box where empty means "none" (null): the parsed value and the message to show.
 * `value` is undefined when the text is not acceptable (nothing should be saved).
 */
export function parseNumberText(
  text: string,
  {min, max, integer = true}: {min?: number; max?: number; integer?: boolean} = {}
): {value: number | null | undefined; error: string | null} {
  if (text.trim() === '') return {value: null, error: null};
  const n = Number(text);
  if (!Number.isFinite(n) || (integer && !Number.isInteger(n)))
    return {value: undefined, error: integer ? 'Enter a whole number' : 'Enter a number'};
  if (min !== undefined && n < min) return {value: undefined, error: `Enter ${min} or more`};
  if (max !== undefined && n > max) return {value: undefined, error: `Enter ${max} or less`};
  return {value: n, error: null};
}

/** Text written to a label/description: trimmed to the schema's limit; empty description removed. */
export const clip = (text: string, max: number) => text.slice(0, max);
