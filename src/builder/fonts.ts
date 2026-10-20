import type { ThemeFont } from '@shared/form/theme'

/**
 * Lazy CSS for each theme font (self-hosted @fontsource-variable, so no Google request). Static
 * imports per font so Vite can split them; only fonts actually shown are downloaded.
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

const loaded = new Map<ThemeFont, Promise<unknown>>()

export function loadThemeFont(font: ThemeFont | null | undefined): Promise<unknown> {
  if (!font) return Promise.resolve()
  let p = loaded.get(font)
  if (!p) {
    p = LOADERS[font]().catch(() => loaded.delete(font))
    loaded.set(font, p)
  }
  return p
}
