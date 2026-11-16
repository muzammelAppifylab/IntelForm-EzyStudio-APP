import {
  changeFieldType,
  newField,
  newFieldId,
  type FormDefinition,
  type FormField,
} from '../../../lib/intelform/form/definition'
import { FIELD_TYPE_META, type FieldType } from '../../../lib/intelform/form/field-types'
import { DATE_FORMATS, type DateFormat } from '../../../lib/intelform/form/types/registry'
import { PIPE_RE, parsePipes, pipeToken } from '../../../lib/intelform/form/logic'

/**
 * Pure edits on a draft definition, used through the store's `commit` (recipes mutate a deep
 * copy in place; see lib/produce.ts). Kept separate so they are easy to test.
 */

export function indexOfField(def: FormDefinition, id: string): number {
  return def.fields.findIndex((f) => f.id === id)
}

/** Defaults from App settings for new fields. */
export interface FieldDefaults {
  dateFormat?: string
}

/** A new field with a sensible starting label. */
export function createField(type: FieldType, defaults: FieldDefaults = {}): FormField {
  const f = newField(type) as FormField
  f.label = type === 'section_break' ? 'New section' : ''
  if (f.type === 'date' && (DATE_FORMATS as readonly string[]).includes(defaults.dateFormat ?? '')) {
    f.props.format = defaults.dateFormat as DateFormat
  }
  return f
}

/** Inserts at `index` (clamped); appends when undefined. Returns the field. */
export function insertField(def: FormDefinition, field: FormField, index?: number): FormField {
  const at = index === undefined ? def.fields.length : Math.max(0, Math.min(index, def.fields.length))
  def.fields.splice(at, 0, field)
  return field
}

/** A copy right below the original, with a new id. Returns the copy's id. */
export function duplicateField(def: FormDefinition, id: string): string | null {
  const i = indexOfField(def, id)
  if (i < 0) return null
  const src = def.fields[i]
  const copy = structuredClone(src) as FormField
  copy.id = newFieldId()
  def.fields.splice(i + 1, 0, copy)
  return copy.id
}

/**
 * Removes the field, every condition that used it (rules left empty are removed) and its
 * answer chips in other texts (each replaced by its fallback word, if it had one).
 */
export function removeField(def: FormDefinition, id: string): void {
  const i = indexOfField(def, id)
  if (i < 0) return
  def.fields.splice(i, 1)
  const strip = (text: string) =>
    text.includes(id) ? text.replace(PIPE_RE, (raw, fid: string, _part?: string, fallback?: string) => (fid === id ? (fallback ?? '') : raw)) : text
  for (const f of def.fields) {
    f.label = strip(f.label)
    if (f.description) f.description = strip(f.description)
    if (!f.logic) continue
    const conditions = f.logic.conditions.filter((c) => c.field !== id)
    if (conditions.length === 0) delete f.logic
    else f.logic.conditions = conditions
  }
  def.startScreen.title = strip(def.startScreen.title)
  if (def.startScreen.description) def.startScreen.description = strip(def.startScreen.description)
  def.endScreen.title = strip(def.endScreen.title)
  def.endScreen.message = strip(def.endScreen.message)
}

export function moveField(def: FormDefinition, from: number, to: number): void {
  if (from === to || from < 0 || from >= def.fields.length) return
  const target = Math.max(0, Math.min(to, def.fields.length - 1))
  const [f] = def.fields.splice(from, 1)
  def.fields.splice(target, 0, f)
}

/**
 * Changes a field's type in place. With `freshId` (the form already has responses) the field
 * gets a new id so old answers stay with the old question, and logic and pipes that pointed at
 * it follow the new id.
 */
export function changeType(def: FormDefinition, id: string, type: FieldType, freshId = false): string | null {
  const i = indexOfField(def, id)
  if (i < 0) return null
  const src = def.fields[i]
  const next = structuredClone(changeFieldType(src, type)) as FormField
  if (!FIELD_TYPE_META[type].stores) delete next.requiredError
  if (freshId) {
    next.id = newFieldId()
    renameReferences(def, id, next.id)
  }
  def.fields[i] = next
  return next.id
}

/** Points every logic condition and pipe token at `to` instead of `from`. */
export function renameReferences(def: FormDefinition, from: string, to: string): void {
  const swap = (text: string) =>
    text.includes(from)
      ? text.replace(PIPE_RE, (raw, fid: string, part?: string, fallback?: string) => (fid === from ? pipeToken(to, part, fallback) : raw))
      : text
  for (const f of def.fields) {
    f.label = swap(f.label)
    if (f.description) f.description = swap(f.description)
    for (const c of f.logic?.conditions ?? []) if (c.field === from) c.field = to
  }
  def.startScreen.title = swap(def.startScreen.title)
  if (def.startScreen.description) def.startScreen.description = swap(def.startScreen.description)
  def.endScreen.title = swap(def.endScreen.title)
  def.endScreen.message = swap(def.endScreen.message)
}

/** Label text with pipe tokens shown as [Question label], for menus and sentences. */
export function plainLabel(text: string, def: FormDefinition): string {
  if (!parsePipes(text).length) return text
  return text.replace(PIPE_RE, (_raw, fid: string, part?: string) => {
    const f = def.fields.find((x) => x.id === fid)
    const name = f ? plainLabel(f.label, { ...def, fields: [] }) || 'answer' : 'deleted answer'
    return `[${name}${part ? ` ${part}` : ''}]`
  })
}

/** Name used for a field in menus, sentences and warnings. */
export function fieldName(def: FormDefinition, f: FormField): string {
  const text = plainLabel(f.label, def).trim()
  if (text) return text
  const n = def.fields.filter((x) => x.type !== 'section_break').findIndex((x) => x.id === f.id) + 1
  return f.type === 'section_break' ? 'Untitled section' : `Question ${n > 0 ? n : '?'}`
}
