import { newFieldId, newOptionId, OTHER_OPTION_ID, type FormDefinition } from '../definition'
import type { FormSettings } from '../settings'

/**
 * Gives a copied template fresh field and option ids, so forms made from the same template
 * never share ids (keeps the responses GIN index selective). Rewrites every reference:
 * logic conditions (source field and option-id values), pipe tokens in text, and the
 * settings that point at fields. "Other" (OTHER_OPTION_ID) keeps its reserved id.
 */
export function remapTemplateIds(
  definition: FormDefinition,
  settings: FormSettings,
): { definition: FormDefinition; settings: FormSettings } {
  const fieldIds = new Map<string, string>()
  const optionIds = new Map<string, Map<string, string>>() // per old field id
  for (const f of definition.fields) {
    fieldIds.set(f.id, newFieldId())
    const options = (f.props as { options?: { id: string }[] }).options
    if (Array.isArray(options)) {
      optionIds.set(f.id, new Map(options.map((o) => [o.id, o.id === OTHER_OPTION_ID ? o.id : newOptionId()])))
    }
  }

  const field = (id: string) => fieldIds.get(id) ?? id
  // {f_abcd}, {f_abcd.first}, {f_abcd|fallback}: swap the id, keep the rest.
  const pipes = <T extends string | null | undefined>(text: T): T =>
    (typeof text === 'string' ? text.replace(/\{(f_[a-z0-9]{4,12})(?=[.|}])/g, (_m, id: string) => `{${field(id)}`) : text) as T

  const fields = definition.fields.map((f) => {
    const map = optionIds.get(f.id)
    const props = f.props as Record<string, unknown>
    const next: Record<string, unknown> = {
      ...f,
      id: field(f.id),
      label: pipes(f.label),
      description: pipes(f.description),
      placeholder: pipes(f.placeholder),
    }
    for (const key of ['description', 'placeholder'] as const) if (next[key] === undefined) delete next[key]
    if (map) {
      next.props = { ...props, options: (props.options as { id: string }[]).map((o) => ({ ...o, id: map.get(o.id) ?? o.id })) }
    }
    if (f.logic) {
      next.logic = {
        ...f.logic,
        conditions: f.logic.conditions.map((c) => {
          const sourceOptions = optionIds.get(c.field)
          const value = typeof c.value === 'string' && sourceOptions?.has(c.value) ? sourceOptions.get(c.value) : c.value
          return { ...c, field: field(c.field), ...(value !== undefined ? { value } : {}) }
        }),
      }
    }
    return next
  }) as FormDefinition['fields']

  const { startScreen, endScreen } = definition
  return {
    definition: {
      ...definition,
      fields,
      startScreen: { ...startScreen, title: pipes(startScreen.title), description: pipes(startScreen.description) },
      endScreen: { ...endScreen, title: pipes(endScreen.title), message: pipes(endScreen.message) },
    },
    settings: {
      ...settings,
      onePerEmailFieldId: settings.onePerEmailFieldId && field(settings.onePerEmailFieldId),
      confirmationEmailFieldId: settings.confirmationEmailFieldId && field(settings.confirmationEmailFieldId),
      confirmationSubject: pipes(settings.confirmationSubject),
      confirmationBody: pipes(settings.confirmationBody),
    },
  }
}
