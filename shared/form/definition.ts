import * as z from 'zod'
import type { ZodMiniType } from 'zod/mini'
import { fieldId, logicRule, newFieldId } from './base'
import type { FieldType } from './field-types'
import { safeUrl } from './safe-url'
import type { FieldTypeCore } from './types/common'
import { coreRegistry, typedRegistry, type PropsOf } from './types/registry'

/**
 * Versioned form definition stored as jsonb in forms.draft and form_versions.definition
 * (PRD "Form definition"). Layout is a display setting, not a form type: the same
 * definition and the same responses work in all three layouts.
 *
 * `field` is a discriminated union on `type`; each member's `props` schema comes from the
 * field-type registry (shared/form/types). Every props key has a default, so partial props
 * (as in the PRD example) parse, and unknown types are rejected.
 */

export {
  CONDITION_OPS,
  OTHER_OPTION_ID,
  VALUELESS_OPS,
  condition,
  fieldId,
  logicRule,
  newFieldId,
  newOptionId,
  optionId,
  type Condition,
  type ConditionOp,
  type LogicRule,
} from './base'

export const LAYOUTS = ['all_at_once', 'section_by_section', 'one_at_a_time'] as const
export type Layout = (typeof LAYOUTS)[number]

export const LAYOUT_LABEL: Record<Layout, string> = {
  all_at_once: 'All at once',
  section_by_section: 'Section by section',
  one_at_a_time: 'One at a time',
}

/** Settings every field shares (PRD "Common settings"). */
const commonShape = {
  id: fieldId,
  /** Supports piping: "Hi {f_8k2m.first|there}". For a section break this is the page title. */
  label: z.string().max(500).default(''),
  description: z.string().max(2000).optional(),
  required: z.boolean().default(false),
  /** Replaces the "required" system label for this field. */
  requiredError: z.string().max(200).optional(),
  hideLabel: z.boolean().optional(),
  /** Only used by types with FIELD_TYPE_META[type].hasPlaceholder. */
  placeholder: z.string().max(200).optional(),
  logic: z.optional(logicRule),
}

function member<T extends FieldType, P extends ZodMiniType>(core: FieldTypeCore<T, P>) {
  return z.object({
    ...commonShape,
    type: z.literal(core.type),
    props: z._default(core.props, () => core.defaultProps() as z.util.NoUndefined<z.output<P>>),
  })
}

const r = typedRegistry
export const field = z.discriminatedUnion('type', [
  member(r.email),
  member(r.name),
  member(r.phone),
  member(r.address),
  member(r.country),
  member(r.short_text),
  member(r.long_text),
  member(r.number),
  member(r.url),
  member(r.date),
  member(r.time),
  member(r.single_choice),
  member(r.multiple_choice),
  member(r.dropdown),
  member(r.yes_no),
  member(r.picture_choice),
  member(r.rating),
  member(r.nps),
  member(r.signature),
  member(r.consent),
  member(r.section_break),
])

export const startScreen = z.object({
  enabled: z.boolean(),
  title: z.string().max(200).default(''),
  description: z.string().max(2000).optional(),
  imageUrl: safeUrl.nullable().optional(),
  /** Alt text for the start image; the pre-publish a11y check warns when it is missing. */
  imageAlt: z.string().max(300).optional(),
  button: z.string().max(40).default('Start'),
  minutes: z.number().int().min(1).max(120).nullable().optional(),
})

export const endScreen = z.object({
  title: z.string().max(200),
  message: z.string().max(2000).default(''),
  /** Optional button under the message, e.g. "Back to our site". */
  button: z.object({ label: z.string().min(1).max(40), url: safeUrl }).nullable().optional(),
  /**
   * Unused: the after-submit redirect is `settings.redirectUrl` (Settings tab → After submit).
   * Kept only so older drafts that carry it still parse.
   */
  redirectUrl: safeUrl.nullable().optional(),
})

export const formDefinition = z
  .object({
    layout: z.enum(LAYOUTS),
    startScreen: startScreen,
    fields: z.array(field).max(500),
    endScreen: endScreen,
  })
  .superRefine((def, ctx) => {
    const seen = new Set<string>()
    def.fields.forEach((f, i) => {
      if (seen.has(f.id)) ctx.addIssue({ code: 'custom', path: ['fields', i, 'id'], message: 'Field ids must be unique' })
      seen.add(f.id)
    })
  })

export type FormField = z.infer<typeof field>
export type FormDefinition = z.infer<typeof formDefinition>
export type StartScreen = z.infer<typeof startScreen>
export type EndScreen = z.infer<typeof endScreen>
/** One member of the field union, e.g. FieldOf<'rating'>. */
export type FieldOf<T extends FieldType> = Extract<FormField, { type: T }>
export type { PropsOf }

/** A new blank form: classic layout, no start screen, the default end screen. */
export function blankDefinition(): FormDefinition {
  return {
    layout: 'all_at_once',
    startScreen: { enabled: false, title: '', button: 'Start' },
    fields: [],
    endScreen: { title: 'Thanks!', message: 'Your response has been recorded.', redirectUrl: null },
  }
}

/** A new field of `type` with default props and a fresh id. */
export function newField<T extends FieldType>(
  type: T,
  init: Partial<Omit<FieldOf<T>, 'type' | 'props'>> & { props?: Partial<PropsOf<T>> } = {},
): FieldOf<T> {
  const core = coreRegistry[type]
  return {
    id: init.id ?? newFieldId(),
    type,
    label: '',
    required: false,
    ...init,
    props: { ...(core.defaultProps() as object), ...(init.props as object | undefined) },
  } as FieldOf<T>
}

/**
 * Change a field's type (PRD: keep label, description and required; drop settings that don't
 * apply). Also keeps the id, required error, hide label, logic, and the placeholder when the
 * new type has one. Props start from the new type's defaults plus whatever `migrateProps` maps.
 */
export function changeFieldType<T extends FieldType>(f: FormField, type: T): FieldOf<T> {
  if (f.type === type) return f as FieldOf<T>
  const core = coreRegistry[type]
  const migrated = core.migrateProps?.(f.type, f.props as Record<string, unknown>) ?? {}
  const kept = Object.fromEntries(Object.entries(migrated).filter(([, v]) => v !== undefined))
  const candidate = { ...(core.defaultProps() as object), ...kept }
  const parsed = core.props.safeParse(candidate)
  const next: Record<string, unknown> = {
    id: f.id,
    type,
    label: f.label,
    required: type === 'section_break' ? false : f.required,
    props: parsed.success ? parsed.data : core.defaultProps(),
  }
  if (f.description !== undefined) next.description = f.description
  if (f.requiredError !== undefined && core.stores) next.requiredError = f.requiredError
  if (f.hideLabel !== undefined) next.hideLabel = f.hideLabel
  if (f.placeholder !== undefined && core.hasPlaceholder) next.placeholder = f.placeholder
  if (f.logic !== undefined) next.logic = f.logic
  return next as FieldOf<T>
}

/** Static pages: split at section breaks. Visibility-aware pages come from logic.computeVisibility. */
export interface DefinitionPage {
  /** The section break that starts this page; null for the first page when the form doesn't start with one. */
  section: FieldOf<'section_break'> | null
  /** The page's fields, section break excluded. */
  fields: FormField[]
}

export function fieldsByPage(def: Pick<FormDefinition, 'fields'>): DefinitionPage[] {
  const pages: DefinitionPage[] = []
  let current: DefinitionPage | null = null
  for (const f of def.fields) {
    if (f.type === 'section_break') {
      current = { section: f, fields: [] }
      pages.push(current)
    } else {
      if (!current) {
        current = { section: null, fields: [] }
        pages.push(current)
      }
      current.fields.push(f)
    }
  }
  return pages
}
