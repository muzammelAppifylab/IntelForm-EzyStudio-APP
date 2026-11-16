import type {CatalogField, CatalogOption} from '../../../lib/intelform/api-responses';
import {field as fieldSchema, type FormField} from '../../../lib/intelform/form/definition';
import type {FieldType} from '../../../lib/intelform/form/field-types';
import {coreRegistry} from '../../../lib/intelform/form/types/registry';
import type {PrismaClient} from '../../../platform/db';

/**
 * The field catalog of a form ("Labels at submission time"):
 * - fields of the published version are current, in form order, with their current labels;
 * - fields only in older versions are appended with their last label and `deleted`;
 * - options removed since are kept (for old answers) and marked deleted.
 * Built in TypeScript from every version's field list: a form has a handful of versions.
 *
 * The form row and every version's field list come back in ONE query. (IntelForm kept a
 * per-process cache of built catalogs; on a Worker there is no long-lived process, so it is
 * rebuilt per request, which is cheap.)
 */

export const GONE = 'That form no longer exists.';

/** Types whose answers are an option (or a fixed value set) and can be counted and filtered. */
export const OPTION_TYPES = new Set<FieldType>(['single_choice', 'dropdown', 'multiple_choice', 'picture_choice']);
export const FILTERABLE_TYPES = new Set<FieldType>([...OPTION_TYPES, 'yes_no', 'country', 'rating', 'nps']);

/** How many versions are read to build the catalog (newest first). */
const MAX_VERSIONS = 200;

export interface CatalogEntry {
  meta: CatalogField;
  /** Field with merged options, labels of deleted options suffixed: for table and summary text. */
  display: FormField;
  /** Same, with plain option labels: for CSV. */
  plain: FormField;
}

export interface CatalogForm {
  id: string;
  title: string;
  slug: string;
  publishedVersionId: string | null;
  /** forms.response_count as read with the catalog. */
  responseCount: number;
}

export interface FormCatalog {
  form: CatalogForm;
  /** Answer fields (no section breaks), current first, then deleted. Read only. */
  entries: CatalogEntry[];
  byId: Map<string, CatalogEntry>;
}

/** Parse a stored field, filling prop defaults; null for anything unrecognisable. */
export function parseField(raw: unknown): FormField | null {
  const parsed = fieldSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const core = (coreRegistry as Record<string, (typeof coreRegistry)[FieldType] | undefined>)[String(r.type)];
  if (!core || typeof r.id !== 'string') return null;
  const props = {
    ...(core.defaultProps() as object),
    ...(r.props && typeof r.props === 'object' ? r.props : {}),
  };
  return {
    id: r.id,
    type: core.type,
    label: typeof r.label === 'string' ? r.label : '',
    required: false,
    props,
  } as FormField;
}

/** The answer fields of a stored field list (section breaks and junk dropped). */
export function parseFieldList(raw: unknown): FormField[] {
  return (Array.isArray(raw) ? raw : []).map(parseField).filter((f): f is FormField => !!f && f.type !== 'section_break');
}

type Opt = {id: string; label: string; [k: string]: unknown};

function optionsOf(f: FormField): Opt[] | null {
  const p = f.props as {options?: Opt[]};
  return OPTION_TYPES.has(f.type) && Array.isArray(p.options) ? p.options : null;
}

function withOptions(f: FormField, options: Opt[]): FormField {
  return {...f, props: {...(f.props as object), options}} as FormField;
}

export interface VersionFields {
  id: string;
  version: number;
  fields: unknown;
}

type CatalogRow = {
  id: string;
  title: string;
  slug: string;
  published_version_id: string | null;
  response_count: number;
  versions: VersionFields[] | null;
};

/** Catalogs of several forms in ONE query (the all-forms export reads a batch at a time). */
export async function loadCatalogs(db: PrismaClient, formIds: readonly string[]): Promise<Map<string, FormCatalog>> {
  const out = new Map<string, FormCatalog>();
  if (!formIds.length) return out;
  const rows = await db.$queryRaw<CatalogRow[]>`
    SELECT f.id, f.title, f.slug, f.published_version_id, f.response_count,
      (SELECT jsonb_agg(jsonb_build_object('id', v.id, 'version', v.version, 'fields', v.definition->'fields') ORDER BY v.version DESC)
       FROM (SELECT id, version, definition FROM form_versions WHERE form_id = f.id ORDER BY version DESC LIMIT ${MAX_VERSIONS}) v) AS versions
    FROM forms f WHERE f.id = ANY(${[...formIds]}::uuid[])
  `;
  for (const row of rows) out.set(String(row.id), catalogOf(row));
  return out;
}

function catalogOf(row: CatalogRow): FormCatalog {
  const built = buildCatalog(row.versions ?? [], row.published_version_id);
  return {
    form: {
      id: row.id,
      title: row.title,
      slug: row.slug,
      publishedVersionId: row.published_version_id,
      responseCount: Number(row.response_count),
    },
    ...built,
  };
}

/** Loads the form and its catalog; null when the form is gone. One query. */
export async function loadCatalog(db: PrismaClient, formId: string): Promise<FormCatalog | null> {
  const [row] = await db.$queryRaw<CatalogRow[]>`
    SELECT f.id, f.title, f.slug, f.published_version_id, f.response_count,
      (SELECT jsonb_agg(jsonb_build_object('id', v.id, 'version', v.version, 'fields', v.definition->'fields') ORDER BY v.version DESC)
       FROM (SELECT id, version, definition FROM form_versions WHERE form_id = f.id ORDER BY version DESC LIMIT ${MAX_VERSIONS}) v) AS versions
    FROM forms f WHERE f.id = ${formId}::uuid
  `;
  if (!row) return null;
  const built = buildCatalog(row.versions ?? [], row.published_version_id);
  return {
    form: {
      id: row.id,
      title: row.title,
      slug: row.slug,
      publishedVersionId: row.published_version_id,
      responseCount: Number(row.response_count),
    },
    ...built,
  };
}

/** Exported for unit tests: versions newest first. */
export function buildCatalog(versions: VersionFields[], publishedVersionId: string | null): Pick<FormCatalog, 'entries' | 'byId'> {
  const published = versions.find(v => v.id === publishedVersionId) ?? null;
  const current = published ? parseFieldList(published.fields) : [];
  const currentIds = new Set(current.map(f => f.id));
  // Latest version first: the first sighting of a field id is its last known shape.
  const latest = new Map<string, FormField>();
  const allOptions = new Map<string, Opt[]>();
  for (const v of versions) {
    for (const f of parseFieldList(v.fields)) {
      if (!latest.has(f.id)) latest.set(f.id, f);
      const opts = optionsOf(f);
      if (opts) {
        const list = allOptions.get(f.id) ?? [];
        for (const o of opts) if (!list.some(x => x.id === o.id)) list.push(o);
        allOptions.set(f.id, list);
      }
    }
  }

  const ordered: {f: FormField; deleted: boolean}[] = [
    ...current.map(f => ({f, deleted: false})),
    ...[...latest.values()].filter(f => !currentIds.has(f.id)).map(f => ({f, deleted: true})),
  ];

  const entries = ordered.map(({f, deleted}): CatalogEntry => {
    const label = f.label.trim() || 'Untitled question';
    let display = f;
    let plain = f;
    let options: CatalogOption[] | undefined;
    const own = optionsOf(f);
    if (own) {
      const ownIds = new Set(own.map(o => o.id));
      const extra = (allOptions.get(f.id) ?? []).filter(o => !ownIds.has(o.id));
      plain = withOptions(f, [...own, ...extra]);
      display = withOptions(f, [
        ...own,
        ...extra.map(o => ({
          ...o,
          label: `${o.label || 'Untitled option'} (deleted option)`,
        })),
      ]);
      options = [
        ...own.map(o => ({
          id: o.id,
          label: o.label || 'Untitled option',
          deleted: false,
        })),
        ...extra.map(o => ({
          id: o.id,
          label: `${o.label || 'Untitled option'} (deleted option)`,
          deleted: true,
        })),
      ];
      if ((f.props as {other?: boolean}).other) options.push({id: 'o_other', label: 'Other', deleted: false});
    } else if (f.type === 'yes_no') {
      const p = f.props as {yesLabel: string; noLabel: string};
      options = [
        {id: 'true', label: p.yesLabel || 'Yes', deleted: false},
        {id: 'false', label: p.noLabel || 'No', deleted: false},
      ];
    }
    const meta: CatalogField = {
      id: f.id,
      type: f.type,
      label: deleted ? `${label} (deleted)` : label,
      deleted,
      ...(options && {options}),
      filterable: FILTERABLE_TYPES.has(f.type),
    };
    return {meta, display, plain};
  });

  return {entries, byId: new Map(entries.map(e => [e.meta.id, e]))};
}
