import type {CatalogField, CatalogOption} from '../../../lib/intelform/api-responses';
import {field as fieldSchema, type FormField} from '../../../lib/intelform/form/definition';
import type {FieldType} from '../../../lib/intelform/form/field-types';
import {coreRegistry} from '../../../lib/intelform/form/types/registry';
import type {PrismaClient} from '../../../platform/db';
import {Prisma} from '../../../generated/prisma/client';
import {exactResponsesSql} from '../forms/counts';

/**
 * The field catalog of a form ("Labels at submission time"):
 * - fields of the published version are current, in form order, with their current labels;
 * - fields only in older versions are appended with their last label and `deleted`;
 * - options removed since are kept (for old answers) and marked deleted.
 *
 * It is PRECOMPUTED (`form_catalogs`, one row per form): publish merges the previous catalog
 * with the new version in O(fields) (`writeCatalogAtPublish`), so every responses page, drawer,
 * Summary and export step reads ONE small row instead of every version's definition. The row
 * keeps only what readers need (id, type, label, required, props; no descriptions or logic) and
 * the `version_id` it was built for: a row that doesn't match the form's published version (a
 * form published before catalogs existed, or by another path) is rebuilt from the versions a
 * bounded batch at a time, oldest first, and stored. Never in the Site Cache (too big).
 */

export const GONE = 'That form no longer exists.';

/** Types whose answers are an option (or a fixed value set) and can be counted and filtered. */
export const OPTION_TYPES = new Set<FieldType>(['single_choice', 'dropdown', 'multiple_choice', 'picture_choice']);
export const FILTERABLE_TYPES = new Set<FieldType>([...OPTION_TYPES, 'yes_no', 'country', 'rating', 'nps']);

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
  /** The exact all-time response count (sum of form_counts), read with the catalog. */
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

// ------------------------------------------------------------------ The stored catalog

/** Bump when the stored shape changes: rows of another shape are rebuilt on read. */
export const CATALOG_FORMAT = 1;

/** A field as stored: only what readers use (no description, logic, placeholder…). */
export type SlimField = Pick<FormField, 'id' | 'type' | 'label' | 'required' | 'props'>;

export interface StoredEntry {
  /** The field's last known shape (the published one for current fields). */
  f: SlimField;
  /** Not in the published version. */
  d: boolean;
  /** Every option this field id ever had (option types), newest first. */
  o?: Opt[];
}

export interface StoredCatalog {
  v: number;
  /** Current fields in form order, then deleted ones, newest sighting first. */
  fields: StoredEntry[];
}

export const EMPTY_CATALOG: StoredCatalog = {v: CATALOG_FORMAT, fields: []};

function slim(f: FormField): SlimField {
  return {id: f.id, type: f.type, label: f.label, required: f.required, props: f.props} as SlimField;
}

/**
 * The catalog after publishing `fields` (the new version's answer fields, already parsed) on
 * top of `prev`: O(fields). The new version's fields are current with their new shape; every
 * other field ever seen stays, marked deleted, in the order it was; options are the union,
 * newest first. Folding versions oldest to newest gives the same catalog as reading them all.
 */
export function mergeCatalog(prev: StoredCatalog | null, fields: readonly FormField[]): StoredCatalog {
  const before = new Map<string, StoredEntry>();
  for (const e of prev?.fields ?? []) before.set(e.f.id, e);
  const seen = new Set<string>();
  const out: StoredEntry[] = [];
  for (const f of fields) {
    if (f.type === 'section_break' || seen.has(f.id)) continue;
    seen.add(f.id);
    const own = optionsOf(f) ?? [];
    const older = before.get(f.id)?.o ?? [];
    const ids = new Set(own.map(o => o.id));
    const all = [...own, ...older.filter(o => !ids.has(o.id))];
    out.push({f: slim(f), d: false, ...(all.length && {o: all})});
  }
  for (const e of prev?.fields ?? []) if (!seen.has(e.f.id)) out.push(e.d ? e : {...e, d: true});
  return {v: CATALOG_FORMAT, fields: out};
}

/** A stored catalog as readers use it (no parsing: it was parsed when written). */
export function entriesOf(stored: StoredCatalog): Pick<FormCatalog, 'entries' | 'byId'> {
  const entries = stored.fields.map(({f: slimmed, d: deleted, o}): CatalogEntry => {
    const f = slimmed as FormField;
    const label = f.label.trim() || 'Untitled question';
    let display = f;
    let plain = f;
    let options: CatalogOption[] | undefined;
    const own = optionsOf(f);
    if (own) {
      const ownIds = new Set(own.map(x => x.id));
      const extra = (o ?? []).filter(x => !ownIds.has(x.id));
      plain = withOptions(f, [...own, ...extra]);
      display = withOptions(f, [...own, ...extra.map(x => ({...x, label: `${x.label || 'Untitled option'} (deleted option)`}))]);
      options = [
        ...own.map(x => ({id: x.id, label: x.label || 'Untitled option', deleted: false})),
        ...extra.map(x => ({id: x.id, label: `${x.label || 'Untitled option'} (deleted option)`, deleted: true})),
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

/**
 * Folds a batch of versions (oldest first) into `cat`, holding back the published one, which goes
 * in last (finishCatalog) so its labels and order win. Used by rebuildCatalog, batch by batch.
 */
export function foldVersions(
  cat: StoredCatalog,
  versions: readonly VersionFields[],
  publishedVersionId: string | null,
  published: VersionFields | null
): {cat: StoredCatalog; published: VersionFields | null} {
  for (const v of [...versions].sort((x, y) => x.version - y.version)) {
    if (v.id === publishedVersionId) published = v;
    else cat = mergeCatalog(cat, parseFieldList(v.fields));
  }
  return {cat, published};
}

/** The published version last; with nothing published, every field is a past one. */
export function finishCatalog(cat: StoredCatalog, published: VersionFields | null): StoredCatalog {
  return published
    ? mergeCatalog(cat, parseFieldList(published.fields))
    : {v: CATALOG_FORMAT, fields: cat.fields.map(e => (e.d ? e : {...e, d: true}))};
}

const isStored = (v: unknown): v is StoredCatalog =>
  !!v && typeof v === 'object' && (v as StoredCatalog).v === CATALOG_FORMAT && Array.isArray((v as StoredCatalog).fields);

// ------------------------------------------------------------------ Reading

type Db = Pick<PrismaClient, '$queryRaw' | '$executeRaw'>;

type CatalogRow = {
  id: string;
  title: string;
  slug: string;
  published_version_id: string | null;
  response_count: number;
  /** The stored catalog when it was built for the published version, else null. */
  catalog: unknown;
};

/** The exact count (the table's and Summary's formTotal: compared right after a delete). */
const EXACT = exactResponsesSql(Prisma.sql`f.id`);

/** Versions read per query when a catalog is rebuilt (each without descriptions or logic). */
const REBUILD_BATCH = 25;

const catalogSelect = Prisma.sql`
  SELECT f.id::text AS id, f.title, f.slug, f.published_version_id::text AS published_version_id, ${EXACT} AS response_count,
    CASE WHEN c.version_id IS NOT DISTINCT FROM f.published_version_id THEN c.catalog END AS catalog
  FROM forms f LEFT JOIN form_catalogs c ON c.form_id = f.id`;

/** Loads the form and its catalog; null when the form is gone. One query (a rebuild, once per form, reads more). */
export async function loadCatalog(db: Db, formId: string): Promise<FormCatalog | null> {
  const [row] = await db.$queryRaw<CatalogRow[]>`${catalogSelect} WHERE f.id = ${formId}::uuid`;
  return row ? catalogOf(db, row) : null;
}

async function catalogOf(db: Db, row: CatalogRow): Promise<FormCatalog> {
  const stored = isStored(row.catalog) ? row.catalog : await rebuildCatalog(db, row.id, row.published_version_id);
  return {
    form: {
      id: row.id,
      title: row.title,
      slug: row.slug,
      publishedVersionId: row.published_version_id,
      responseCount: Number(row.response_count),
    },
    ...entriesOf(stored),
  };
}

/**
 * Builds a form's catalog from its versions (oldest first, REBUILD_BATCH at a time, so memory
 * stays bounded however many there are) and stores it for the next read. The store is best
 * effort: a read never fails because the row couldn't be written, and a row is only written
 * while the form still has that published version.
 */
export async function rebuildCatalog(db: Db, formId: string, publishedVersionId: string | null): Promise<StoredCatalog> {
  let cat: StoredCatalog = EMPTY_CATALOG;
  let published: VersionFields | null = null;
  let after = 0;
  for (;;) {
    const batch = await db.$queryRaw<VersionFields[]>`
      SELECT v.id::text AS id, v.version,
        (SELECT coalesce(jsonb_agg(e - 'description' - 'descriptionFormat' - 'logic' - 'placeholder' - 'requiredError' ORDER BY n), '[]'::jsonb)
         FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v.definition->'fields') = 'array' THEN v.definition->'fields' ELSE '[]'::jsonb END)
           WITH ORDINALITY AS x(e, n)
         WHERE e->>'type' IS DISTINCT FROM 'section_break') AS fields
      FROM form_versions v
      WHERE v.form_id = ${formId}::uuid AND v.version > ${after}::int
      ORDER BY v.version
      LIMIT ${REBUILD_BATCH}
    `;
    ({cat, published} = foldVersions(cat, batch, publishedVersionId, published));
    if (batch.length < REBUILD_BATCH) break;
    after = Number(batch.at(-1)!.version);
  }
  cat = finishCatalog(cat, published);
  try {
    await db.$executeRaw`
      INSERT INTO form_catalogs (form_id, version_id, catalog, updated_at)
      SELECT f.id, f.published_version_id, ${JSON.stringify(cat)}::jsonb, now()
      FROM forms f WHERE f.id = ${formId}::uuid AND f.published_version_id IS NOT DISTINCT FROM ${publishedVersionId}::uuid
      ON CONFLICT (form_id) DO UPDATE SET version_id = EXCLUDED.version_id, catalog = EXCLUDED.catalog, updated_at = now()
      WHERE form_catalogs.version_id IS DISTINCT FROM EXCLUDED.version_id OR form_catalogs.catalog->'v' IS DISTINCT FROM EXCLUDED.catalog->'v'
    `;
  } catch (err) {
    console.warn(`[intelform] catalog not stored (${err instanceof Error ? err.name : 'error'})`);
  }
  return cat;
}

// ------------------------------------------------------------------ Writing (publish)

/**
 * At publish, inside its transaction (the form row locked): the new version's catalog from the
 * previous one in O(fields), two statements. `prevVersionId` is the version that was live before
 * (null on a first publish). When the previous catalog isn't stored (a form published before
 * catalogs existed), nothing is written: the first read rebuilds it from every version.
 */
export async function writeCatalogAtPublish(
  tx: Pick<PrismaClient, '$queryRaw' | '$executeRaw'>,
  formId: string,
  prevVersionId: string | null,
  version: {id: string; version: number},
  fields: readonly FormField[]
): Promise<void> {
  let prev: StoredCatalog | null = null;
  if (version.version === 1) prev = EMPTY_CATALOG;
  else if (prevVersionId) {
    const [row] = await tx.$queryRaw<{catalog: unknown}[]>`
      SELECT catalog FROM form_catalogs WHERE form_id = ${formId}::uuid AND version_id = ${prevVersionId}::uuid`;
    if (row && isStored(row.catalog)) prev = row.catalog;
  }
  if (!prev) return;
  const next = mergeCatalog(prev, fields);
  await tx.$executeRaw`
    INSERT INTO form_catalogs (form_id, version_id, catalog, updated_at)
    VALUES (${formId}::uuid, ${version.id}::uuid, ${JSON.stringify(next)}::jsonb, now())
    ON CONFLICT (form_id) DO UPDATE SET version_id = EXCLUDED.version_id, catalog = EXCLUDED.catalog, updated_at = now()
  `;
}
