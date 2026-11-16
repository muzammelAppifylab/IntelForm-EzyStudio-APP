import {CONTROL, cx} from './util';

/**
 * Class lists for the respondent's inputs and buttons: one place, so every renderer and layout
 * draws the same themed controls. Plain CSS classes (the respondent stylesheet, `rf-` prefix),
 * built from the form theme's custom properties; legacy pinned Tailwind class lists here.
 *
 * The stylesheet contract (owned by the respondent screens):
 *   .rf-input           text input look (border, background, focus ring, invalid state)
 *   .rf-control-box     48px tall, answer font size, form font, form radius
 *   .rf-control         + horizontal padding
 *   .rf-button          button base (focus ring, press, disabled, icon sizing)
 *   .rf-button-primary  theme button colour + button text colour
 *   .rf-button-outline  outlined, on the form background
 *   .rf-button-form     48px tall, form radius, form font, answer size
 *   .rf-button-icon     48px square, radius capped at 12px
 *   .rf-button-sm       the small dashboard-style button (error retry)
 */

/** A themed text input, 48px (the same look as legacy `<Input className={CONTROL}>`). */
export const inputClass = (className?: string) => cx('rf-input', CONTROL, className);

const BUTTON_VARIANT = {
  default: 'rf-button-primary',
  outline: 'rf-button-outline',
} as const;
export type ButtonVariant = keyof typeof BUTTON_VARIANT;

/** The themed 48px button (Next, Submit, Start). */
export const formButtonClass = (variant: ButtonVariant = 'default', className?: string) =>
  cx('rf-button', BUTTON_VARIANT[variant], 'rf-button-form', className);

/** An outlined 48px square icon button (Back / up / down in one-at-a-time). */
export const iconButtonClass = cx('rf-button', BUTTON_VARIANT.outline, 'rf-button-icon');

/** A small outlined button (error retry). */
export const smallButtonClass = cx('rf-button', BUTTON_VARIANT.outline, 'rf-button-sm');
