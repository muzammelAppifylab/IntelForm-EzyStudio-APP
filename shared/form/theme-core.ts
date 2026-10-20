import type { FormTheme, ThemeColors } from './theme'
export type { FormTheme, ThemeColors } from './theme'

/**
 * The zod-free half of the form theme: fonts, presets, colour maths and CSS variables.
 * `theme.ts` re-exports all of it next to the `formTheme` schema; import from there, except in
 * the respondent bundle, which imports this file so the (classic zod) schema stays out of it.
 */

export const THEME_FONTS = [
  'Inter',
  'DM Sans',
  'Work Sans',
  'Nunito',
  'Montserrat',
  'Source Sans 3',
  'Manrope',
  'Plus Jakarta Sans',
  'Space Grotesk',
  'Playfair Display',
  'Lora',
  'Fraunces',
] as const
export type ThemeFont = (typeof THEME_FONTS)[number]

const SERIF: readonly ThemeFont[] = ['Playfair Display', 'Lora', 'Fraunces']

/** CSS font stack for a theme font (self-hosted @fontsource-variable family names). */
export function fontStack(font: ThemeFont): string {
  const fallback = SERIF.includes(font) ? 'ui-serif, Georgia, serif' : 'ui-sans-serif, system-ui, sans-serif'
  return `"${font} Variable", "${font}", ${fallback}`
}

/** npm package that holds the font, for the lazy CSS import in the renderer. */
export function fontPackage(font: ThemeFont): string {
  return `@fontsource-variable/${font.toLowerCase().replace(/\s+/g, '-')}`
}

export const FONT_SIZES = ['s', 'm', 'l'] as const
export const BUTTON_RADII = ['square', 'rounded', 'pill'] as const
export const ALIGNMENTS = ['left', 'center'] as const

/** The IntelForm preset colours, also the schema default. */
export const DEFAULT_COLORS = {
  background: '#F7F5FF',
  question: '#1A1825',
  answer: '#5B3FD9',
  button: '#5B3FD9',
  buttonText: '#FFFFFF',
}

export interface ThemePreset {
  id: string
  name: string
  mode: 'light' | 'dark'
  theme: FormTheme
}

function preset(
  id: string,
  name: string,
  mode: 'light' | 'dark',
  colors: ThemeColors,
  font: ThemeFont,
  extra: Partial<FormTheme> = {},
): ThemePreset {
  return {
    id,
    name,
    mode,
    theme: {
      preset: id,
      colors,
      font,
      questionFont: null,
      fontSize: 'm',
      background: { type: 'solid' },
      logo: null,
      buttonRadius: 'rounded',
      alignment: 'left',
      ...extra,
    },
  }
}

/** 8 built-in presets: 4 light, then 4 dark. The first is the IntelForm default. */
export const THEME_PRESETS: readonly ThemePreset[] = [
  preset('intelform', 'IntelForm', 'light', DEFAULT_COLORS, 'Inter', { questionFont: 'Space Grotesk' }),
  preset(
    'linen',
    'Linen',
    'light',
    { background: '#FAF8F3', question: '#1F2A24', answer: '#0F6E5C', button: '#0F6E5C', buttonText: '#FFFFFF' },
    'Source Sans 3',
    { questionFont: 'Lora' },
  ),
  preset(
    'apricot',
    'Apricot',
    'light',
    { background: '#FFF6EE', question: '#3B1D0E', answer: '#B4460F', button: '#B4460F', buttonText: '#FFFFFF' },
    'Nunito',
    { buttonRadius: 'pill' },
  ),
  preset(
    'gazette',
    'Gazette',
    'light',
    { background: '#FFFFFF', question: '#111111', answer: '#1D4ED8', button: '#111111', buttonText: '#FFFFFF' },
    'Work Sans',
    { questionFont: 'Fraunces', buttonRadius: 'square' },
  ),
  preset(
    'midnight',
    'Midnight',
    'dark',
    { background: '#12101F', question: '#F2F0FF', answer: '#A897FF', button: '#A897FF', buttonText: '#15112E' },
    'Manrope',
  ),
  preset(
    'evergreen',
    'Evergreen',
    'dark',
    { background: '#0F1F1A', question: '#ECFDF5', answer: '#6EE7B7', button: '#34D399', buttonText: '#052E22' },
    'DM Sans',
  ),
  preset(
    'ember',
    'Ember',
    'dark',
    { background: '#1A1715', question: '#FAF7F2', answer: '#FB923C', button: '#FB923C', buttonText: '#2A1204' },
    'Space Grotesk',
    { buttonRadius: 'pill', alignment: 'center' },
  ),
  preset(
    'harbor',
    'Harbor',
    'dark',
    { background: '#0B1B2B', question: '#E6F1FF', answer: '#7DD3FC', button: '#38BDF8', buttonText: '#04223A' },
    'Plus Jakarta Sans',
    { questionFont: 'Playfair Display' },
  ),
]

/**
 * The IntelForm preset. `formTheme.parse({})` gives the same settings except questionFont
 * (null there, i.e. the body font).
 */
export function defaultTheme(): FormTheme {
  return structuredClone(THEME_PRESETS[0].theme)
}

export function themePreset(id: string): ThemePreset | undefined {
  return THEME_PRESETS.find((p) => p.id === id)
}

// ---------------------------------------------------------------------------------------
// Colour maths (WCAG 2 relative luminance; Oklab mixing to predict color-mix())

type Rgb = [number, number, number]

export function hexToRgb(hex: string): Rgb {
  let h = hex.trim().replace(/^#/, '')
  if (h.length === 3) h = h.replace(/./g, (c) => c + c)
  const n = Number.parseInt(h.slice(0, 6), 16)
  if (!/^[0-9a-f]{6}$/i.test(h.slice(0, 6)) || Number.isNaN(n)) throw new Error(`Not a hex colour: ${hex}`)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function rgbToHex([r, g, b]: Rgb): string {
  const c = (x: number) => Math.round(Math.min(255, Math.max(0, x))).toString(16).padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`.toUpperCase()
}

const toLinear = (c: number) => {
  const s = c / 255
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}
const fromLinear = (l: number) => 255 * (l <= 0.0031308 ? 12.92 * l : 1.055 * l ** (1 / 2.4) - 0.055)

/** WCAG 2 relative luminance, 0–1. */
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(toLinear)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG 2 contrast ratio between two hex colours, 1–21. */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

export function isDarkColor(hex: string): boolean {
  // Midpoint where black and white text have equal contrast.
  return luminance(hex) < 0.179
}

function toOklab(hex: string): Rgb {
  const [r, g, b] = hexToRgb(hex).map(toLinear)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

function fromOklab([L, A, B]: Rgb): string {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3
  return rgbToHex([
    fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ])
}

/** What `color-mix(in oklab, a pct%, b)` renders as (pct of a, 0–100). */
export function mixOklab(a: string, pct: number, b: string): string {
  const p = pct / 100
  const x = toOklab(a)
  const y = toOklab(b)
  return fromOklab([x[0] * p + y[0] * (1 - p), x[1] * p + y[1] * (1 - p), x[2] * p + y[2] * (1 - p)])
}

const mix = (a: string, pct: number, b: string) => `color-mix(in oklab, ${a} ${pct}%, ${b})`

// ---------------------------------------------------------------------------------------
// Theme → CSS variables

/** Mix percentages used by themeToVars, exported so the tests can check their contrast. */
export const TINTS = {
  surfaceLight: 30, // % of background mixed into white
  surfaceDark: 90, // % of background mixed into white
  mutedForeground: 72, // % of question colour over the background
  placeholder: 68,
  input: 58,
  border: 14,
  optionSelected: 12, // % of answer colour over the surface
  muted: 6,
  progressTrack: 14,
} as const

const RADIUS = { square: '0rem', rounded: '0.625rem', pill: '0.75rem' } as const
const BUTTON_RADIUS = { square: '0rem', rounded: '0.5rem', pill: '9999px' } as const
const FONT_SCALE = { s: '0.9375', m: '1', l: '1.125' } as const

/** The colour the surface (cards, inputs, options) resolves to. */
export function surfaceColor(theme: FormTheme): string {
  const bg = theme.colors.background
  return isDarkColor(bg) ? mixOklab(bg, TINTS.surfaceDark, '#FFFFFF') : mixOklab(bg, TINTS.surfaceLight, '#FFFFFF')
}

/**
 * CSS custom properties for `.form-theme`: the --form-* set plus the shadcn and design-system
 * tokens used inside the form, with tints derived by color-mix() so contrast holds in light
 * and dark themes. Apply as inline style on the form root.
 */
export function themeToVars(theme: FormTheme): Record<string, string> {
  const { background: bg, question: q, answer: a, button, buttonText } = theme.colors
  const dark = isDarkColor(bg)
  const surface = dark ? mix(bg, TINTS.surfaceDark, '#FFFFFF') : mix(bg, TINTS.surfaceLight, '#FFFFFF')
  const font = fontStack(theme.font)
  const questionFont = fontStack(theme.questionFont ?? theme.font)
  const image = theme.background.type === 'image' ? theme.background : null
  const fg = (pct: number) => mix(q, pct, bg)
  return {
    // Form tokens
    '--form-bg': bg,
    '--form-surface': surface,
    '--form-question': q,
    '--form-answer': a,
    '--form-button': button,
    '--form-button-foreground': buttonText,
    '--form-button-border': q,
    '--form-progress': a,
    '--form-font': font,
    '--form-question-font': questionFont,
    '--form-radius': BUTTON_RADIUS[theme.buttonRadius],
    '--form-font-scale': FONT_SCALE[theme.fontSize],
    '--form-align': theme.alignment,
    '--form-bg-image': image ? `url(${JSON.stringify(image.imageUrl)})` : 'none',
    '--form-bg-overlay': image ? String(image.overlay / 100) : '0',
    '--form-color-scheme': dark ? 'dark' : 'light',
    // Design-system typefaces, so text-* classes inside the form follow the theme
    '--typeface-sans': font,
    '--typeface-display': questionFont,
    // shadcn / design-system tokens
    '--background': bg,
    '--foreground': q,
    '--card': surface,
    '--card-foreground': q,
    '--popover': surface,
    '--popover-foreground': q,
    '--primary': button,
    '--primary-foreground': buttonText,
    // The 2px ink edge on buttons and selected states follows the question (text) colour.
    '--primary-border': q,
    // Darker on light backgrounds, lighter on dark ones (as in the design system).
    '--primary-hover': mix(button, 86, dark ? '#FFFFFF' : '#000000'),
    '--secondary': fg(TINTS.muted),
    '--secondary-foreground': q,
    '--muted': fg(TINTS.muted),
    '--muted-foreground': fg(TINTS.mutedForeground),
    '--accent': mix(a, TINTS.optionSelected, surface),
    '--accent-foreground': q,
    '--border': fg(TINTS.border),
    '--border-ink': q,
    '--input': fg(TINTS.input),
    '--ring': a,
    '--field': surface,
    '--field-placeholder': fg(TINTS.placeholder),
    '--option': surface,
    '--option-border': fg(TINTS.input),
    '--option-selected': mix(a, TINTS.optionSelected, surface),
    '--option-selected-border': a,
    '--option-selected-foreground': q,
    '--progress': a,
    '--progress-track': fg(TINTS.progressTrack),
    '--radius': RADIUS[theme.buttonRadius],
  }
}

// ---------------------------------------------------------------------------------------
// Contrast warnings (PRD: warn, never block)

export interface ContrastIssue {
  key: 'question' | 'buttonText' | 'answer' | 'button'
  ratio: number
  required: number
  message: string
}

/**
 * WCAG AA checks: 4.5:1 for question text and button text, 3:1 for the answer colour
 * (selected options, focus ring) and the button against the background. With an image
 * background the check runs against the background colour under the darken overlay.
 */
export function themeContrastIssues(theme: FormTheme): ContrastIssue[] {
  const c = theme.colors
  const bg =
    theme.background.type === 'image' && theme.background.overlay > 0
      ? mixOklab('#000000', theme.background.overlay, c.background)
      : c.background
  const imageNote = theme.background.type === 'image' ? ' (checked against the background colour under the overlay)' : ''
  const checks: [ContrastIssue['key'], string, string, number, string][] = [
    ['question', c.question, bg, 4.5, 'Question text is hard to read on the background'],
    ['buttonText', c.buttonText, c.button, 4.5, 'Button text is hard to read on the button'],
    ['answer', c.answer, bg, 3, 'The answer colour is hard to see on the background'],
    ['button', c.button, bg, 3, 'The button is hard to see on the background'],
  ]
  const out: ContrastIssue[] = []
  for (const [key, fg, back, required, text] of checks) {
    const ratio = contrastRatio(fg, back)
    if (ratio < required) {
      const r = Math.floor(ratio * 10) / 10
      out.push({ key, ratio, required, message: `${text}${imageNote}: ${r}:1, needs ${required}:1. Pick a lighter or darker colour.` })
    }
  }
  return out
}
