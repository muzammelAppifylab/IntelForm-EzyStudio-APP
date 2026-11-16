import type {TemplateSummary} from '../../../lib/intelform/api-forms';
import type {FormDefinition} from '../../../lib/intelform/form/definition';
import {formSettings, type FormSettings} from '../../../lib/intelform/form/settings';
import {BUILTIN_TEMPLATES as SHARED_BUILTINS} from '../../../lib/intelform/form/templates/index';
import {defaultTheme, type FormTheme} from '../../../lib/intelform/form/theme';

/**
 * The 10 built-in templates, as the server serves them.
 *
 * Legacy IntelForm upserted these into the `templates` table at boot (server/db/seed.ts, keyed
 * by a content hash). Here they are CODE ONLY: no boot-time seeding, no rows. The definitions
 * live in src/lib/intelform/form/templates (browser-safe, shared with the gallery preview); this
 * module adds what the seed added: full settings (defaults filled in), the default theme, and a
 * fixed id so the dashboard can keep sending `templateId` for a built-in exactly as it does for
 * a saved one.
 *
 * Since this is a module constant, reading it costs no query and needs no Site Cache entry.
 */

export interface ServerBuiltinTemplate {
  /** Fixed, never reused: `00000000-0000-4000-8000-0000000b00NN` (NN = sortOrder). */
  id: string;
  slug: string;
  name: string;
  category: string;
  description: string;
  sortOrder: number;
  definition: FormDefinition;
  /** Full settings (defaultFormSettings() plus the template's own). */
  settings: FormSettings;
  theme: FormTheme;
  /** Fields a respondent answers (section breaks don't count). */
  fieldCount: number;
}

/** A built-in's id: stable for as long as its sortOrder is. */
export const builtinTemplateId = (sortOrder: number) => `00000000-0000-4000-8000-0000000b${String(sortOrder).padStart(4, '0')}`;

/** Fields a respondent answers in a definition (section breaks are layout only). */
export function countFields(definition: {fields?: readonly {type: string}[]} | null | undefined): number {
  return (definition?.fields ?? []).filter(f => f.type !== 'section_break').length;
}

/** When the built-ins were "created", for the summary's `createdAt` (they have no row). */
const BUILTIN_CREATED_AT = new Date(0).toISOString();

export const BUILTIN_TEMPLATES: readonly ServerBuiltinTemplate[] = SHARED_BUILTINS.map(t => ({
  id: builtinTemplateId(t.sortOrder),
  slug: t.slug,
  name: t.name,
  category: t.category,
  description: t.description,
  sortOrder: t.sortOrder,
  definition: t.definition,
  settings: formSettings.parse(t.settings ?? {}),
  theme: defaultTheme(),
  fieldCount: countFields(t.definition),
}));

const byId = new Map(BUILTIN_TEMPLATES.map(t => [t.id, t]));
const bySlug = new Map(BUILTIN_TEMPLATES.map(t => [t.slug, t]));

/** The built-in with this id or slug, if any. */
export function findBuiltinTemplate(idOrSlug: string | null | undefined): ServerBuiltinTemplate | undefined {
  if (!idOrSlug) return undefined;
  return byId.get(idOrSlug.toLowerCase()) ?? bySlug.get(idOrSlug);
}

export const isBuiltinTemplateId = (id: string) => byId.has(id.toLowerCase());

/** The gallery card of a built-in. */
export function builtinTemplateSummary(t: ServerBuiltinTemplate): TemplateSummary {
  return {
    id: t.id,
    slug: t.slug,
    name: t.name,
    category: t.category,
    description: t.description,
    isBuiltin: true,
    layout: t.definition.layout,
    fieldCount: t.fieldCount,
    createdBy: null,
    createdAt: BUILTIN_CREATED_AT,
  };
}

/** Built-in gallery cards, in sortOrder. Computed once per isolate. */
export const BUILTIN_TEMPLATE_SUMMARIES: readonly TemplateSummary[] = [...BUILTIN_TEMPLATES]
  .sort((a, b) => a.sortOrder - b.sortOrder)
  .map(builtinTemplateSummary);
