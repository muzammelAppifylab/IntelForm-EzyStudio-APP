/**
 * Class fragments shared by the respondent-facing ds components. Inside a `.form-theme` they follow
 * the form's Design tab variables; anywhere else they fall back to the system tokens.
 */

/**
 * Corner shape the creator picks (`--form-radius`), else the system `radius-lg`. Capped at 12px: a
 * "pill" theme sets --form-radius to 9999px for buttons, which would turn multi-line tiles into capsules.
 */
export const FORM_RADIUS = 'rounded-[min(var(--form-radius,var(--radius)),0.75rem)]'

/** The form's answer font (`--form-font`), else Figtree. */
export const FORM_FONT = 'font-[family-name:var(--form-font,var(--typeface-sans))]'

/*
 * The respondent bundle joins classes with plain clsx (no tailwind-merge), so these fragments never
 * contain two classes for the same property: a caller adds exactly one of TILE_REST / TILE_SELECTED,
 * and its own alignment (`items-center`, `items-start`…).
 */

/** Option tile structure: layout, transition, hover/focus/disabled behaviour, a 98% press. No colours, no alignment. */
export const TILE_BASE =
  'press-tile relative flex cursor-pointer border transition-[background-color,border-color,box-shadow,scale] duration-(--duration-fast) ease-out has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring has-disabled:cursor-not-allowed has-disabled:opacity-50'

/** Option tile at rest: `option` fill, 1px `option-border`, `accent` on hover. */
export const TILE_REST = 'border-option-border bg-option text-foreground hover:bg-accent'

/**
 * Selected tile: `option-selected` fill, 2px `option-selected-border` (1px border + 1px inset ring, so
 * nothing shifts). Inside a themed form the border follows `--form-answer` (the IntelForm preset maps it
 * to `primary`, which equals `option-selected-border`).
 */
export const TILE_SELECTED =
  'border-[color:var(--form-answer,var(--option-selected-border))] bg-option-selected text-option-selected-foreground ring-1 ring-[color:var(--form-answer,var(--option-selected-border))] ring-inset hover:border-[color:var(--form-answer,var(--option-selected-border))] hover:bg-option-selected'

/**
 * Selected key badge or checkbox mark inside a tile: filled with the selected edge colour
 * (`--form-answer`, else `option-selected-border`: ink in light, periwinkle in dark) and lettered in the
 * tile's own surface colour (`--form-surface`, else `option`). That is the option-selected-border on
 * option pairing (16:1 light, 7.5:1 dark), so the letter or check never melts into its fill.
 */
export const KEY_SELECTED =
  'border-[color:var(--form-answer,var(--option-selected-border))] bg-[color:var(--form-answer,var(--option-selected-border))] text-[color:var(--form-surface,var(--option))]'

/** Tile colours for a checked / unchecked state (exactly one of the two sets). */
export const tileState = (checked: boolean) => (checked ? TILE_SELECTED : TILE_REST)

/**
 * Text field look (TextField spec) without corner radius, font size, height or padding, which each
 * control sets once: `field` background, 1px `input` outline (3:1) that darkens on hover, the 2px focus ring, `destructive` outline when `aria-invalid`.
 */
export const FIELD =
  'focus-ring w-full min-w-0 border border-input bg-field text-foreground transition-[color,border-color] duration-(--duration-fast) ease-out hover:border-muted-foreground placeholder:text-field-placeholder disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:hover:border-destructive'

/** Extra single-line input behaviour (selection colour, file button, read-only hover). */
export const INPUT_EXTRA =
  'selection:bg-primary selection:text-primary-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-label file:text-foreground read-only:hover:border-input'

/** Letters for keyboard selection: A–Z. Options past the 26th get no key. */
export const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
