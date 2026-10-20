import type { CatalogField, CatalogOption } from '../../shared/api-responses'
import { field as fieldSchema, type FormField } from '../../shared/form/definition'
import type { FieldType } from '../../shared/form/field-types'
import { coreRegistry } from '../../shared/form/types/registry'
import { sql } from '../db/client'
import { notFound } from '../lib/errors'

/**
 * The field catalog of a form (docs/research/05-data-analytics.md "Labels at submission time"):
 * - fields of the published version are current, in form order, with their current labels;
 * - fields only in older versions are appended with their last label and `deleted`;
 * - options removed since are kept (for old answers) and marked deleted.
 * Built in TypeScript from every version's field list: a form has a handful of versions.
 */

export const GONE = 'That form no longer exists'

/** Types whose answers are an option (or a fixed value set) and can be counted and filtered. */
export const OPTION_TYPES = new Set<FieldType>(['single_choice', 'dropdown', 'multiple_choice', 'picture_choice'])
export const FILTERABLE_TYPES = new Set<FieldType>([...OPTION_TYPES, 'yes_no', 'country', 'rating', 'nps'])

export interface CatalogEntry {
  meta: CatalogField
  /** Field with merged options, labels of deleted options suffixed: for table and summary text. */
  display: FormField
  /** Same, with plain option labels: for CSV. */
  plain: FormField
}

export interface FormCatalog {
  form: { id: string; title: string; slug: string; publishedVersionId: string | null }
  /** Answer fields (no section breaks), current first, then deleted. */
  entries: CatalogEntry[]
  byId: Map<string, CatalogEntry>
}

/** Parse a stored field, filling prop defaults; null for anything unrecognisable. */
export function parseField(raw: unknown): FormField | null {
  const parsed = fieldSchema.safeParse(raw)
  if (parsed.success) return parsed.data
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const core = (coreRegistry as Record<string, (typeof coreRegistry)[FieldType] | undefined>)[String(r.type)]
  if (!core || typeof r.id !== 'string') return null
  const props = { ...(core.defaultProps() as object), ...(r.props && typeof r.props === 'object' ? r.props : {}) }
  return { id: r.id, type: core.type, label: typeof r.label === 'string' ? r.label : '', required: false, props } as FormField
}

type Opt = { id: string; label: string; [k: string]: unknown }

function optionsOf(f: FormField): Opt[] | null {
  const p = f.props as { options?: Opt[] }
  return OPTION_TYPES.has(f.type) && Array.isArray(p.options) ? p.options : null
}

function withOptions(f: FormField, options: Opt[]): FormField {
  return { ...f, props: { ...(f.props as object), options } } as FormField
}

/** Loads the form and its catalog; 404 when the form is gone. */
export async function loadCatalog(formId: string): Promise<FormCatalog> {
  const [form] = await sql<{ id: string; title: string; slug: string; published_version_id: string | null }[]>`
    SELECT id, title, slug, published_version_id FROM forms WHERE id = ${formId}
  `
  if (!form) throw notFound(GONE)
  const versions = await sql<{ id: string; version: number; fields: unknown }[]>`
    SELECT id, version, definition->'fields' AS fields FROM form_versions WHERE form_id = ${formId} ORDER BY version DESC
  `
  const published = versions.find((v) => v.id === form.published_version_id) ?? null
  const parseList = (raw: unknown): FormField[] =>
    (Array.isArray(raw) ? raw : []).map(parseField).filter((f): f is FormField => !!f && f.type !== 'section_break')

  const current = published ? parseList(published.fields) : []
  const currentIds = new Set(current.map((f) => f.id))
  // Latest version first: the first sighting of a field id is its last known shape.
  const latest = new Map<string, FormField>()
  const allOptions = new Map<string, Opt[]>()
  for (const v of versions) {
    for (const f of parseList(v.fields)) {
      if (!latest.has(f.id)) latest.set(f.id, f)
      const opts = optionsOf(f)
      if (opts) {
        const list = allOptions.get(f.id) ?? []
        for (const o of opts) if (!list.some((x) => x.id === o.id)) list.push(o)
        allOptions.set(f.id, list)
      }
    }
  }

  const ordered: { f: FormField; deleted: boolean }[] = [
    ...current.map((f) => ({ f, deleted: false })),
    ...[...latest.values()].filter((f) => !currentIds.has(f.id)).map((f) => ({ f, deleted: true })),
  ]

  const entries = ordered.map(({ f, deleted }): CatalogEntry => {
    const label = f.label.trim() || 'Untitled question'
    let display = f
    let plain = f
    let options: CatalogOption[] | undefined
    const own = optionsOf(f)
    if (own) {
      const ownIds = new Set(own.map((o) => o.id))
      const extra = (allOptions.get(f.id) ?? []).filter((o) => !ownIds.has(o.id))
      plain = withOptions(f, [...own, ...extra])
      display = withOptions(f, [...own, ...extra.map((o) => ({ ...o, label: `${o.label || 'Untitled option'} (deleted option)` }))])
      options = [
        ...own.map((o) => ({ id: o.id, label: o.label || 'Untitled option', deleted: false })),
        ...extra.map((o) => ({ id: o.id, label: `${o.label || 'Untitled option'} (deleted option)`, deleted: true })),
      ]
      if ((f.props as { other?: boolean }).other) options.push({ id: 'o_other', label: 'Other', deleted: false })
    } else if (f.type === 'yes_no') {
      const p = f.props as { yesLabel: string; noLabel: string }
      options = [
        { id: 'true', label: p.yesLabel || 'Yes', deleted: false },
        { id: 'false', label: p.noLabel || 'No', deleted: false },
      ]
    }
    const meta: CatalogField = {
      id: f.id,
      type: f.type,
      label: deleted ? `${label} (deleted)` : label,
      deleted,
      ...(options && { options }),
      filterable: FILTERABLE_TYPES.has(f.type),
    }
    return { meta, display, plain }
  })

  return {
    form: { id: form.id, title: form.title, slug: form.slug, publishedVersionId: form.published_version_id },
    entries,
    byId: new Map(entries.map((e) => [e.meta.id, e])),
  }
}
