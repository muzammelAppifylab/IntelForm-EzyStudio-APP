import type { CSSProperties } from 'react'
import { THEME_PRESETS, themePreset, themeToVars, type ThemeFont, type ThemePreset } from '@shared/form/theme'

/**
 * Lazy font CSS per theme font (self-hosted Fontsource). Inter and Space Grotesk are already
 * in the app shell, so the IntelForm preset loads nothing extra.
 */
const FONT_LOADERS: Record<ThemeFont, (() => Promise<unknown>) | null> = {
  Inter: null,
  'Space Grotesk': null,
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
}

export function loadPresetFonts(preset: ThemePreset): void {
  const fonts = new Set([preset.theme.font, preset.theme.questionFont ?? preset.theme.font])
  for (const f of fonts) void FONT_LOADERS[f]?.().catch(() => {})
}

export function homePreset(themeId: string): ThemePreset {
  return themePreset(themeId) ?? THEME_PRESETS[0]
}

/** CSS variables for the front page root: the preset mapped onto the design-system tokens. */
export function homeThemeStyle(preset: ThemePreset): CSSProperties {
  return themeToVars(preset.theme) as CSSProperties
}
