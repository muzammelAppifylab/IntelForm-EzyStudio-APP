import {themeToVars, type FormTheme} from '../lib/intelform/form/theme-core';

/**
 * The form theme as a CSS rule, for the public page's server render: one <style> in <head>
 * whose sha256 the page adds to the CSP (`Astro.csp.insertStyleHash`), so the first paint
 * (and the no-JavaScript closed / not-found screens) is themed without any `style=""`
 * attribute. The React shell sets the same properties through the CSSOM once it runs.
 *
 * The theme was parsed by its zod schema on the server (hex colours, a fixed font list, a safe
 * https/relative image URL), so values are plain; still, nothing here may close the <style>
 * element or the rule: `<` is written as a CSS escape, and a value carrying `{`, `}` or `;`
 * outside a quoted string is dropped.
 */
export function themeCss(theme: FormTheme, selector = '.rf-page'): string {
  const decls: string[] = [];
  for (const [name, value] of Object.entries(themeToVars(theme))) {
    if (!/^--[a-z0-9-]+$/.test(name)) continue;
    const safe = cssValue(value);
    if (safe !== null) decls.push(`${name}:${safe}`);
  }
  return `${selector}{${decls.join(';')}}`;
}

/** A custom-property value safe inside a <style> element, or null when it isn't. */
export function cssValue(value: string): string | null {
  const escaped = value.replace(/</g, '\\3c ').replace(/>/g, '\\3e ');
  // Outside double-quoted strings, no rule or declaration breaks.
  const unquoted = escaped.replace(/"(?:[^"\\]|\\.)*"/g, '""');
  if (/[{};]/.test(unquoted) || /["']/.test(unquoted.replace(/""/g, ''))) return null;
  if (/[\r\n]/.test(escaped)) return null;
  return escaped;
}

/** `sha256-<base64>` of a <style> element's exact text, as the CSP wants it. */
export async function styleHash(css: string): Promise<`sha256-${string}`> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(css));
  let bin = '';
  for (const b of new Uint8Array(digest)) bin += String.fromCharCode(b);
  return `sha256-${btoa(bin)}`;
}
