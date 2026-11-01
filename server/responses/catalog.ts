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
  /** responseCount is forms.response_count as read with the catalog. */
  form: { id: string; title: string; slug: string; publishedVersionId: string | null; responseCount: number }
  /** Answer fields (no section breaks), current first, then deleted. Shared through the cache: read only. */
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

type FormRow = { id: string; title: string; slug: string; published_version_id: string | null; response_count: number }
type VersionRow = { id: string; version: number; fields: unknown }
type Built = Pick<FormCatalog, 'entries' | 'byId'>

/**
 * Built catalogs by form, tagged with the published version they were built from. Versions are
 * append-only and publishing moves published_version_id to the newest, so (form, published
 * version) fixes the version list: a hit skips reading (and detoasting) every definition.
 * Per process; the oldest entry is dropped past CATALOG_CACHE_SIZE.
 */
const CATALOG_CACHE_SIZE = 200
const cache = new Map<string, { versionId: string | null; built: Built }>()

function remember(formId: string, versionId: string | null, built: Built) {
  cache.delete(formId)
  cache.set(formId, { versionId, built })
  if (cache.size > CATALOG_CACHE_SIZE) cache.delete(cache.keys().next().value!)
}

const loadVersions = (formId: string) => sql<VersionRow[]>`
  SELECT id, version, definition->'fields' AS fields FROM form_versions WHERE form_id = ${formId} ORDER BY version DESC
`

/** Loads the form and its catalog; 404 when the form is gone. */
export async function loadCatalog(formId: string): Promise<FormCatalog> {
  const cached = cache.get(formId)
  // Cold: read the form and its versions together. Warm: the form row decides whether the cache holds.
  const [[form], prefetched] = await Promise.all([
    sql<FormRow[]>`SELECT id, title, slug, published_version_id, response_count FROM forms WHERE id = ${formId}`,
    cached ? null : loadVersions(formId),
  ])
  if (!form) {
    cache.delete(formId)
    throw notFound(GONE)
  }
  let built = cached?.versionId === form.published_version_id ? cached.built : null
  if (!built) {
    let versions = prefetched ?? (await loadVersions(formId))
    // The two reads are separate snapshots: a publish in between leaves them out of step, so read again.
    const consistent = (v: VersionRow[]) => (v[0]?.id ?? null) === form.published_version_id
    if (!consistent(versions) && prefetched) versions = await loadVersions(formId)
    built = buildCatalog(versions, form.published_version_id)
    if (consistent(versions)) remember(formId, form.published_version_id, built)
  }
  return {
    form: { id: form.id, title: form.title, slug: form.slug, publishedVersionId: form.published_version_id, responseCount: form.response_count },
    ...built,
  }
}

function buildCatalog(versions: VersionRow[], publishedVersionId: string | null): Built {
  const published = versions.find((v) => v.id === publishedVersionId) ?? null
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

  return { entries, byId: new Map(entries.map((e) => [e.meta.id, e])) }
}
