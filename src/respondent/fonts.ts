/**
 * Theme fonts for the respondent: self-hosted woff2 files in /fonts, registered on demand with
 * the FontFace API (one shared loader with the builder, src/portal/intelform/builder/fonts.ts,
 * which imports nothing but a type). The public page also preloads the theme's files in <head>
 * (`themeFontFiles`), so the first paint rarely swaps.
 */
export {FONT_FILES, FONTS_BASE, loadThemeFont, loadThemeFonts} from '../portal/intelform/builder/fonts';
import {FONT_FILES, FONTS_BASE} from '../portal/intelform/builder/fonts';
import type {ThemeFont} from '../lib/intelform/form/theme-core';

/** The /fonts/ URLs a theme uses (answers and questions), for <link rel="preload">. */
export function themeFontFiles(theme: {font?: ThemeFont | null; questionFont?: ThemeFont | null}): string[] {
  const out: string[] = [];
  for (const font of [theme.font, theme.questionFont]) {
    const src = font ? FONT_FILES[font] : null;
    const url = src ? `${FONTS_BASE}${src.file}` : null;
    if (url && !out.includes(url)) out.push(url);
  }
  return out;
}
