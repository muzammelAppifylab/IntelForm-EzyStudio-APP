import {type RefObject, useLayoutEffect} from 'react';

import {fontStack, type FormTheme, type ThemeColors, type ThemePreset} from '../../../../lib/intelform/form/theme-core';

/**
 * The Design tab's pure parts (tested in tests/intelform/builder-design.test.ts), plus the hook
 * that paints a swatch through the CSSOM: a theme's colours are DATA, not app chrome, and the
 * CSP refuses `style=""`, so they reach the page as custom properties set on the element.
 */

export const COLOR_FIELDS: {key: keyof ThemeColors; label: string; help: string}[] = [
  {key: 'background', label: 'Background', help: 'Page behind the form'},
  {key: 'question', label: 'Questions', help: 'Labels and descriptions'},
  {key: 'answer', label: 'Answers', help: 'Selected options, focus, progress'},
  {key: 'button', label: 'Button', help: 'Next, Submit, Start'},
  {key: 'buttonText', label: 'Button text', help: 'Text on the button'},
];

/** Picking a preset sets every option, but keeps the form's logo. */
export function applyPreset(theme: FormTheme, preset: ThemePreset): FormTheme {
  return {...structuredClone(preset.theme), logo: theme.logo ? structuredClone(theme.logo) : null};
}

export const isHex6 = (v: string) => /^#[0-9a-f]{6}$/i.test(v);

/** What the hex box holds after a keystroke: always with its `#`. */
export function hexInput(raw: string): string {
  const v = raw.trim();
  return v.startsWith('#') ? v : `#${v}`;
}

const RADIUS = {square: '0', rounded: '4px', pill: '999px'} as const;

/** The custom properties a preset card or a saved theme's swatch paints with. */
export function swatchVars(theme: Pick<FormTheme, 'colors' | 'font' | 'questionFont' | 'buttonRadius'>): Record<string, string> {
  return {
    '--sw-bg': theme.colors.background,
    '--sw-question': theme.colors.question,
    '--sw-answer': theme.colors.answer,
    '--sw-button': theme.colors.button,
    '--sw-button-text': theme.colors.buttonText,
    '--sw-font': fontStack(theme.questionFont ?? theme.font),
    '--sw-radius': RADIUS[theme.buttonRadius] ?? RADIUS.rounded,
  };
}

/** Sets custom properties on an element through the CSSOM (allowed by the CSP). */
export function useCssVars(ref: RefObject<HTMLElement | null>, vars: Record<string, string>) {
  const key = JSON.stringify(vars);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const parsed = JSON.parse(key) as Record<string, string>;
    for (const [name, value] of Object.entries(parsed)) el.style.setProperty(name, value);
  }, [ref, key]);
}
