import type {Prisma, PrismaClient} from '../../../generated/prisma/client';
import type {SavedTheme, SavedThemesResponse} from '../../../lib/intelform/api-builder';
import {formTheme, THEME_PRESETS, type FormTheme, type ThemePreset} from '../../../lib/intelform/form/theme';
import {isUuid} from '../templates/validate';

/**
 * Saved form themes (PRD "Theme → Saved themes"), ported from legacy server/routes/themes.ts:
 * everyone with FORM_READ lists them, FORM_WRITE saves and deletes. The presets are code
 * (THEME_PRESETS in src/lib/intelform/form/theme-core.ts) and never rows.
 *
 * Not cached (docs/agent/cache.md): only the Design tab and the app settings read the list, and
 * whoever just saved a theme expects it there.
 */

export const THEME_GONE = 'That theme no longer exists';
/** Legacy listed at most 200 themes, newest first. */
export const THEMES_LIMIT = 200;

interface ThemeRow {
  id: string;
  name: string;
  settings: unknown;
  createdAt: Date;
  createdBy: {name: string} | null;
}

/** A saved theme, field by field; `null` when its settings no longer parse (skipped in lists). */
export function savedThemeView(row: ThemeRow): SavedTheme | null {
  const parsed = formTheme.safeParse(row.settings);
  if (!parsed.success) return null;
  return {
    id: row.id,
    name: row.name,
    settings: parsed.data,
    createdBy: row.createdBy?.name ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

const select = {id: true, name: true, settings: true, createdAt: true, createdBy: {select: {name: true}}} as const;

export async function listSavedThemes(db: PrismaClient): Promise<SavedThemesResponse> {
  const rows = await db.theme.findMany({select, orderBy: [{createdAt: 'desc'}, {id: 'desc'}], take: THEMES_LIMIT});
  const themes: SavedTheme[] = [];
  for (const row of rows) {
    const view = savedThemeView(row);
    if (view) themes.push(view);
  }
  return {themes};
}

export async function createSavedTheme(
  db: PrismaClient,
  input: {name: string; settings: FormTheme},
  user: {id: number; name: string | null}
): Promise<SavedTheme> {
  const row = await db.theme.create({
    data: {name: input.name, settings: input.settings as unknown as Prisma.InputJsonValue, createdById: user.id},
    select: {id: true, createdAt: true},
  });
  return {id: row.id, name: input.name, settings: input.settings, createdBy: user.name, createdAt: row.createdAt.toISOString()};
}

/** `true` when a theme was deleted. */
export async function deleteSavedTheme(db: PrismaClient, id: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  const {count} = await db.theme.deleteMany({where: {id}});
  return count > 0;
}

export interface ThemePresetsResponse {
  presets: readonly ThemePreset[];
}

/** The built-in presets (the same list the Design tab imports directly). */
export const themePresets = (): ThemePresetsResponse => ({presets: THEME_PRESETS});
