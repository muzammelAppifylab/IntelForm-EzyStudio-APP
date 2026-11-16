import type {Prisma, PrismaClient} from '../../../generated/prisma/client';
import type {TemplateSummary, TemplatesResponse} from '../../../lib/intelform/api-forms';
import {LAYOUTS, type FormDefinition, type Layout} from '../../../lib/intelform/form/definition';
import {copyableSettings, type FormSettings} from '../../../lib/intelform/form/settings';
import type {FormTheme} from '../../../lib/intelform/form/theme';
import {BUILTIN_TEMPLATE_SUMMARIES, countFields, findBuiltinTemplate} from './builtins';
import {isUuid} from './validate';

/**
 * Templates: the built-ins (code, ./builtins.ts) plus the ones teammates saved from a form
 * (`templates` rows). Ported from legacy server/routes/templates.ts and the template parts of
 * server/routes/forms.ts (create-from-template, save-as-template).
 *
 * Not cached (docs/agent/cache.md): the built-ins are a module constant (no query at all), and
 * the saved list is read only by the dashboard, where whoever just saved expects to see it.
 */

export const TEMPLATE_GONE = 'That template no longer exists';
export const BUILTIN_LOCKED = 'Built-in templates can’t be changed. Use it, then save your copy as a template.';
/** Saved templates sort after the built-ins, newest first within the same order. */
export const SAVED_SORT_ORDER = 1000;
/** Category of a template saved without one. */
export const SAVED_CATEGORY = 'Saved';

interface SavedRow {
  id: string;
  slug: string;
  name: string;
  category: string;
  description: string;
  definition: unknown;
  createdAt: Date;
  createdBy: {name: string} | null;
}

function layoutOf(definition: unknown): Layout {
  const layout = (definition as {layout?: unknown} | null)?.layout;
  return (LAYOUTS as readonly unknown[]).includes(layout) ? (layout as Layout) : 'all_at_once';
}

function fieldsOf(definition: unknown): {type: string}[] {
  const fields = (definition as {fields?: unknown} | null)?.fields;
  return Array.isArray(fields) ? fields.filter((f): f is {type: string} => !!f && typeof (f as {type?: unknown}).type === 'string') : [];
}

/** A saved template's gallery card, field by field. */
export function savedTemplateSummary(row: SavedRow): TemplateSummary {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    category: row.category,
    description: row.description,
    isBuiltin: false,
    layout: layoutOf(row.definition),
    fieldCount: countFields({fields: fieldsOf(row.definition)}),
    createdBy: row.createdBy?.name ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Categories in display order: the built-ins' order first, then saved ones as they appear. */
export function templateCategories(templates: readonly TemplateSummary[]): string[] {
  return [...new Set(templates.map(t => t.category))];
}

/** Saved templates listed at most (the gallery shows the first 100, newest first within their order). */
export const SAVED_TEMPLATES_MAX = 100;

interface SavedListRow {
  id: string;
  slug: string;
  name: string;
  category: string;
  description: string;
  created_at: Date;
  layout: string | null;
  field_count: number;
  created_by: string | null;
}

/** GET /site-api/templates: built-ins first (sortOrder), then saved (sortOrder, newest first). */
export async function listTemplates(db: PrismaClient): Promise<TemplatesResponse> {
  // Layout and question count are worked out in SQL, so no definition JSON leaves the database.
  const rows = await db.$queryRaw<SavedListRow[]>`
    SELECT t.id::text AS id, t.slug, t.name, t.category, t.description, t.created_at,
      t.definition->>'layout' AS layout,
      (SELECT count(*)::int FROM jsonb_array_elements(
         CASE WHEN jsonb_typeof(t.definition->'fields') = 'array' THEN t.definition->'fields' ELSE '[]'::jsonb END) f
       WHERE jsonb_typeof(f->'type') = 'string' AND f->>'type' <> 'section_break') AS field_count,
      u.name AS created_by
    FROM templates t LEFT JOIN users u ON u.id = t.created_by
    ORDER BY t.sort_order ASC, t.created_at DESC
    LIMIT ${SAVED_TEMPLATES_MAX}`;
  const saved = rows.map(
    (r): TemplateSummary => ({
      id: r.id,
      slug: r.slug,
      name: r.name,
      category: r.category,
      description: r.description,
      isBuiltin: false,
      layout: layoutOf({layout: r.layout}),
      fieldCount: Number(r.field_count),
      createdBy: r.created_by,
      createdAt: r.created_at.toISOString(),
    })
  );
  const templates = [...BUILTIN_TEMPLATE_SUMMARIES, ...saved];
  return {templates, categories: templateCategories(templates)};
}

export type TemplateChange = {ok: true} | {ok: false; status: 403 | 404; error: 'builtin_template' | 'not_found'; message: string};

const gone = (): TemplateChange => ({ok: false, status: 404, error: 'not_found', message: TEMPLATE_GONE});
const locked = (): TemplateChange => ({ok: false, status: 403, error: 'builtin_template', message: BUILTIN_LOCKED});

/** PATCH /site-api/templates/:id: rename a saved template (category/description only when sent). */
export async function updateSavedTemplate(
  db: PrismaClient,
  id: string,
  input: {name: string; category?: string; description?: string}
): Promise<TemplateChange> {
  if (findBuiltinTemplate(id)) return locked();
  if (!isUuid(id)) return gone();
  const {count} = await db.template.updateMany({
    where: {id},
    data: {
      name: input.name,
      ...(input.category !== undefined ? {category: input.category} : {}),
      ...(input.description !== undefined ? {description: input.description} : {}),
    },
  });
  return count ? {ok: true} : gone();
}

/** DELETE /site-api/templates/:id: saved templates only. */
export async function deleteSavedTemplate(db: PrismaClient, id: string): Promise<TemplateChange> {
  if (findBuiltinTemplate(id)) return locked();
  if (!isUuid(id)) return gone();
  const {count} = await db.template.deleteMany({where: {id}});
  return count ? {ok: true} : gone();
}

/**
 * What a new form copies from a template: the same four columns legacy `POST /api/forms`
 * selected (`name, definition, theme, settings`), from a built-in or a saved row, by id or slug.
 * `null` when there is no such template (answer 404 `TEMPLATE_GONE`).
 *
 * The caller (routes/forms.ts) does the rest exactly as before: normalise the definition, read
 * the theme when it is non-empty, and `remapTemplateIds(definition, copyableSettings(settings, true))`.
 */
export interface TemplateSource {
  name: string;
  definition: unknown;
  theme: unknown;
  settings: unknown;
}

export async function loadTemplateSource(
  db: PrismaClient,
  ref: {templateId?: string | null; templateSlug?: string | null}
): Promise<TemplateSource | null> {
  const key = ref.templateId ?? ref.templateSlug ?? '';
  const builtin = findBuiltinTemplate(key);
  if (builtin) return {name: builtin.name, definition: builtin.definition, theme: builtin.theme, settings: builtin.settings};
  const select = {name: true, definition: true, theme: true, settings: true} as const;
  if (ref.templateId) {
    if (!isUuid(ref.templateId)) return null;
    return db.template.findUnique({where: {id: ref.templateId}, select});
  }
  if (ref.templateSlug) return db.template.findUnique({where: {slug: ref.templateSlug}, select});
  return null;
}

/** `saved-` plus 12 lowercase base-36 characters. */
export function savedTemplateSlug(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return `saved-${Array.from(bytes, b => (b % 36).toString(36)).join('')}`;
}

/**
 * "Save as template" (legacy `POST /api/forms/:id/save-as-template`, which routes/forms.ts keeps
 * owning): stores the form's draft, theme and the settings a template may copy (no password,
 * webhook or recipients). Pass the draft already repaired (`repairOrBlank`).
 */
export async function saveFormAsTemplate(
  db: PrismaClient,
  form: {title: string; draft: FormDefinition; theme: FormTheme; settings: FormSettings},
  input: {name?: string; category?: string; description?: string},
  user: {id: number; name: string | null}
): Promise<TemplateSummary> {
  const row = await db.template.create({
    data: {
      slug: savedTemplateSlug(),
      name: (input.name ?? form.title).slice(0, 120),
      category: input.category ?? SAVED_CATEGORY,
      description: input.description ?? '',
      definition: form.draft as unknown as Prisma.InputJsonValue,
      theme: form.theme as unknown as Prisma.InputJsonValue,
      settings: copyableSettings(form.settings, true) as unknown as Prisma.InputJsonValue,
      sortOrder: SAVED_SORT_ORDER,
      createdById: user.id,
    },
    select: {id: true, slug: true, name: true, category: true, description: true, createdAt: true},
  });
  return savedTemplateSummary({...row, definition: form.draft, createdBy: user.name === null ? null : {name: user.name}});
}
