import type {KeyboardEvent} from 'react';

/** Respondent helpers shared by the renderers and layouts (no components here). */

/**
 * Joins class names, skipping falsy ones. The public form uses plain CSS classes (no Tailwind,
 * no merging): pick a variant with a conditional instead of overriding a class.
 */
export function cx(...parts: (string | false | null | undefined | 0)[]): string {
  return parts.filter(Boolean).join(' ');
}

/**
 * The themed 48px control box without horizontal padding (legacy: TextField size lg, the form
 * font and the form radius). Styled by the respondent stylesheet from the form theme's
 * custom properties (`--form-radius`, `--form-font`…).
 */
export const CONTROL_BOX = 'rf-control-box';

/** The themed 48px text control (box + horizontal padding). */
export const CONTROL = cx(CONTROL_BOX, 'rf-control');

/**
 * Enter in a single-line input advances (one-at-a-time). Ignored during IME composition and with
 * modifiers; without `onAdvance` the native form handles Enter (Next / Submit).
 */
export function enterToAdvance(e: KeyboardEvent<HTMLElement>, onAdvance?: () => void): void {
  if (!onAdvance || e.key !== 'Enter') return;
  if (e.nativeEvent.isComposing || e.keyCode === 229) return;
  if (e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return;
  e.preventDefault();
  onAdvance();
}

/** Fisher–Yates with a seed, so a randomised option order stays put while the form is open. */
export function shuffled<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  let s = seed || 1;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Region names in the respondent's language (falls back to English, then the code). */
let regionNames: Intl.DisplayNames | null | undefined;
export function regionName(code: string): string {
  if (regionNames === undefined) {
    try {
      const lang = typeof document !== 'undefined' ? document.documentElement.lang : '';
      const nav = typeof navigator !== 'undefined' ? navigator.language : 'en';
      regionNames = new Intl.DisplayNames([lang || nav, 'en'], {type: 'region'});
    } catch {
      regionNames = null;
    }
  }
  try {
    return regionNames?.of(code) ?? code;
  } catch {
    return code;
  }
}

/** The respondent's likely country from the browser language ("en-GB" → "GB"). */
export function guessCountry(languages: readonly string[] = browserLanguages()): string | null {
  for (const lang of languages) {
    const m = /-([A-Z]{2})\b/i.exec(lang);
    if (m) return m[1].toUpperCase();
  }
  return null;
}

function browserLanguages(): readonly string[] {
  if (typeof navigator === 'undefined') return [];
  return navigator.languages?.length ? navigator.languages : [navigator.language];
}
