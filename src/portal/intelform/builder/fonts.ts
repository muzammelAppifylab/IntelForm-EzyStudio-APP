import type {ThemeFont} from '../../../lib/intelform/form/theme';

/**
 * Lazy web fonts for form themes. Fonts are self-hosted (security.md: nothing loaded from
 * another origin; performance.md: woff2 in `public/fonts`), one variable `woff2` per family at
 * `/fonts/<file>`, registered on demand with the FontFace API so only fonts actually shown are
 * downloaded. A missing file fails quietly: the theme's fallback stack shows instead.
 * (Legacy imported the @fontsource-variable CSS packages through Vite.)
 *
 * Shared by the builder (theme picker, preview) and the respondent.
 */
export interface FontSource {
  /** File under /fonts/ (latin subset, variable weight). */
  file: string;
  /** Weight range of the variable font. */
  weight: string;
  style?: 'normal' | 'italic';
}

export const FONT_FILES: Record<ThemeFont, FontSource | null> = {
  Inter: {file: 'inter-latin-wght-normal.woff2', weight: '100 900'},
  'DM Sans': {file: 'dm-sans-latin-wght-normal.woff2', weight: '100 1000'},
  'Work Sans': {file: 'work-sans-latin-wght-normal.woff2', weight: '100 900'},
  Nunito: {file: 'nunito-latin-wght-normal.woff2', weight: '200 1000'},
  Montserrat: {file: 'montserrat-latin-wght-normal.woff2', weight: '100 900'},
  'Source Sans 3': {file: 'source-sans-3-latin-wght-normal.woff2', weight: '200 900'},
  Manrope: {file: 'manrope-latin-wght-normal.woff2', weight: '200 800'},
  'Plus Jakarta Sans': {file: 'plus-jakarta-sans-latin-wght-normal.woff2', weight: '200 800'},
  'Space Grotesk': {file: 'space-grotesk-latin-wght-normal.woff2', weight: '300 700'},
  'Playfair Display': {file: 'playfair-display-latin-wght-normal.woff2', weight: '400 900'},
  Lora: {file: 'lora-latin-wght-normal.woff2', weight: '400 700'},
  Fraunces: {file: 'fraunces-latin-wght-normal.woff2', weight: '100 900'},
  Figtree: {file: 'figtree-latin-wght-normal.woff2', weight: '300 900'},
  'Instrument Serif': {file: 'instrument-serif-latin-400-normal.woff2', weight: '400'},
};

export const FONTS_BASE = '/fonts/';

const loaded = new Map<ThemeFont, Promise<unknown>>();

export function loadThemeFont(font: ThemeFont | null | undefined): Promise<unknown> {
  if (!font || typeof document === 'undefined' || typeof FontFace === 'undefined') return Promise.resolve();
  let p = loaded.get(font);
  if (!p) {
    const src = FONT_FILES[font];
    if (!src) return Promise.resolve();
    const face = new FontFace(font, `url(${FONTS_BASE}${src.file}) format('woff2')`, {
      weight: src.weight,
      style: src.style ?? 'normal',
      display: 'swap',
    });
    p = face
      .load()
      .then(f => {
        document.fonts.add(f);
        return f;
      })
      .catch(() => loaded.delete(font));
    loaded.set(font, p);
  }
  return p;
}

/** Both fonts a theme uses (answers and questions), fire and forget. */
export function loadThemeFonts(theme: {font?: ThemeFont | null; questionFont?: ThemeFont | null}): void {
  void loadThemeFont(theme.font);
  if (theme.questionFont && theme.questionFont !== theme.font) void loadThemeFont(theme.questionFont);
}
