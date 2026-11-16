import type { CSSProperties } from 'react'
import { THEME_PRESETS, themePreset, themeToVars, type ThemeFont, type ThemePreset } from '@shared/form/theme'

/**
 * Lazy font CSS per theme font (self-hosted Fontsource). Figtree and Instrument Serif are
 * already in the app shell (styles/fonts.css), so the IntelForm preset loads nothing extra.
 */
const FONT_LOADERS: Record<ThemeFont, (() => Promise<unknown>) | null> = {
  Inter: () => import('@fontsource-variable/inter'),
  'Space Grotesk': () => import('@fontsource-variable/space-grotesk'),
  'DM Sans': () => import('@fontsource-variable/dm-sans'),
  'Work Sans': () => import('@fontsource-variable/work-sans'),
  Nunito: () => import('@fontsource-variable/nunito'),
  Montserrat: () => import('@fontsource-variable/montserrat'),
  'Source Sans 3': () => import('@fontsource-variable/source-sans-3'),
  Manrope: () => import('@fontsource-variable/manrope'),
  'Plus Jakarta Sans': () => import('@fontsource-variable/plus-jakarta-sans'),
  'Playfair Display': () => import('@fontsource-variable/playfair-display'),
  Lora: () => import('@fontsource-variable/lora'),
  Fraunces: () => import('@fontsource-variable/fraunces'),
  Figtree: null,
  'Instrument Serif': null,
}

export function loadPresetFonts(preset: ThemePreset): void {
  const fonts = new Set([preset.theme.font, preset.theme.questionFont ?? preset.theme.font])
  for (const f of fonts) void FONT_LOADERS[f]?.().catch(() => {})
}

/**
 * The public site's look: one of the form theme presets (shared/form/theme.ts), mapped onto the
 * design-system tokens. Change the id to restyle every public page.
 */
export const SITE_THEME_ID = 'intelform'

export const SITE_PRESET: ThemePreset = themePreset(SITE_THEME_ID) ?? THEME_PRESETS[0]

/** CSS variables for the site root: the preset mapped onto the design-system tokens. */
export function siteThemeStyle(preset: ThemePreset): CSSProperties {
  return themeToVars(preset.theme) as CSSProperties
}
