import type { FormTheme, ThemeFont } from '@shared/form/theme'

/**
 * Theme fonts load on demand: each import is its own CSS chunk (self-hosted @fontsource-variable,
 * font-display: swap), so a form only downloads the families it uses. Keys mirror THEME_FONTS
 * and fontPackage() in shared/form/theme.ts.
 */
const LOADERS: Record<ThemeFont, () => Promise<unknown>> = {
  Inter: () => import('@fontsource-variable/inter'),
  'DM Sans': () => import('@fontsource-variable/dm-sans'),
  'Work Sans': () => import('@fontsource-variable/work-sans'),
  Nunito: () => import('@fontsource-variable/nunito'),
  Montserrat: () => import('@fontsource-variable/montserrat'),
  'Source Sans 3': () => import('@fontsource-variable/source-sans-3'),
  Manrope: () => import('@fontsource-variable/manrope'),
  'Plus Jakarta Sans': () => import('@fontsource-variable/plus-jakarta-sans'),
  'Space Grotesk': () => import('@fontsource-variable/space-grotesk'),
  'Playfair Display': () => import('@fontsource-variable/playfair-display'),
  Lora: () => import('@fontsource-variable/lora'),
  Fraunces: () => import('@fontsource-variable/fraunces'),
}

const loaded = new Set<string>()

export function loadThemeFonts(theme: Pick<FormTheme, 'font' | 'questionFont'>): void {
  for (const font of [theme.font, theme.questionFont]) {
    if (!font || loaded.has(font)) continue
    loaded.add(font)
    LOADERS[font]?.().catch(() => loaded.delete(font))
  }
}
