import { clsx } from 'clsx'
import { FIELD, FORM_FONT, INPUT_EXTRA } from '@/components/ds/tokens'
import { CONTROL } from './util'

/**
 * Class lists for the respondent's inputs and buttons. They stand in for ui/Input and ui/Button,
 * which merge classes with tailwind-merge (via cn) that the form bundle leaves out. Each list is
 * what cn produced for the respondent's overrides (classes.test.ts checks that), split so no two
 * classes set the same property.
 */

/** ui/Input with the 48px themed control (the same look as `<Input className={CONTROL}>`). */
export const inputClass = (className?: string) => clsx(FIELD, INPUT_EXTRA, 'py-1', CONTROL, className)

/** ui/Button's base classes minus the ones each control sets once (radius, type, gap). */
const BUTTON =
  "focus-ring press inline-flex shrink-0 cursor-pointer items-center justify-center whitespace-nowrap transition-[color,background-color,border-color,opacity,scale] duration-(--duration-fast) ease-out disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"

const BUTTON_VARIANT = {
  default: 'border-2 border-primary-border bg-primary text-primary-foreground hover:bg-primary-hover',
  outline: 'border-2 border-primary-border bg-secondary text-secondary-foreground hover:bg-accent hover:text-accent-foreground',
} as const
export type ButtonVariant = keyof typeof BUTTON_VARIANT

/** `<Button size="lg" className="rounded-[var(--form-radius)] FORM_FONT">`: the themed 48px button. */
export const formButtonClass = (variant: ButtonVariant = 'default', className?: string) =>
  clsx(BUTTON, BUTTON_VARIANT[variant], 'h-(--control-lg) gap-2 px-6 text-answer font-medium has-[>svg]:px-4 rounded-[var(--form-radius)]', FORM_FONT, className)

/** `<Button variant="outline" size="icon-lg" className="rounded-[min(var(--form-radius),0.75rem)]">`. */
export const iconButtonClass = clsx(BUTTON, BUTTON_VARIANT.outline, 'size-(--control-lg) gap-2 text-label rounded-[min(var(--form-radius),0.75rem)]')

/** `<Button variant="outline" size="sm">`: the dashboard-style small button (error retry). */
export const smallButtonClass = clsx(BUTTON, BUTTON_VARIANT.outline, 'h-(--control-sm) gap-1.5 px-3 has-[>svg]:px-2.5 rounded-md text-label')

