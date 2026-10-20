import * as z from 'zod'
import { safeUrl } from './safe-url'
import { ALIGNMENTS, BUTTON_RADII, DEFAULT_COLORS, FONT_SIZES, THEME_FONTS } from './theme-core'

export * from './theme-core'

/**
 * Form theme (PRD "Theme"). Every setting becomes a CSS custom property on the form root
 * (`.form-theme`), mapped onto the shadcn / design-system tokens the renderer already uses,
 * so the renderer needs no per-theme code. Stored in forms.theme, form_versions.theme and
 * themes.settings.
 *
 * This file holds the schema (classic zod, for the server and builder). Presets, colour maths
 * and `themeToVars` live in theme-core.ts and are re-exported here.
 */

/** "#RGB" or "#RRGGBB", stored as uppercase "#RRGGBB". */
export const hexColor = z
  .string()
  .trim()
  .regex(/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i, 'Use a hex colour like #5B3FD9')
  .transform((v) => (v.length === 4 ? `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}` : v).toUpperCase())

export const themeColors = z.object({
  background: hexColor,
  /** Question text, labels, descriptions. */
  question: hexColor,
  /** Answers, selected options, focus ring, progress. */
  answer: hexColor,
  button: hexColor,
  buttonText: hexColor,
})

export const themeBackground = z.discriminatedUnion('type', [
  z.object({ type: z.literal('solid') }),
  z.object({
    type: z.literal('image'),
    imageUrl: safeUrl,
    /** Darken overlay in percent, 0–80. */
    overlay: z.number().int().min(0).max(80).default(40),
  }),
])

export const formTheme = z.object({
  /** The preset this theme started from (informational; settings below are the truth). */
  preset: z.string().max(40).nullable().default('intelform'),
  colors: themeColors.default(DEFAULT_COLORS),
  font: z.enum(THEME_FONTS).default('Inter'),
  /** Font for question text; null = same as `font`. */
  questionFont: z.enum(THEME_FONTS).nullable().default(null),
  fontSize: z.enum(FONT_SIZES).default('m'),
  background: themeBackground.default({ type: 'solid' }),
  logo: z
    .object({
      url: safeUrl,
      position: z.enum(['left', 'center']).default('left'),
      alt: z.string().max(200).optional(),
    })
    .nullable()
    .default(null),
  buttonRadius: z.enum(BUTTON_RADII).default('rounded'),
  /** One-at-a-time questions and start / end screens. */
  alignment: z.enum(ALIGNMENTS).default('left'),
})

export type FormTheme = z.infer<typeof formTheme>
export type ThemeColors = z.infer<typeof themeColors>

