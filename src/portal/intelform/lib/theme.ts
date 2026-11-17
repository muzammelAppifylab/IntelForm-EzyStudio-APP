/**
 * Light / dark for IntelForm on top of the template's theme switch.
 *
 * The template owns the member's own choice: the dashboard top bar's theme menu writes
 * `data-theme="light" | "dark"` on <html> and remembers it under `site:theme`
 * (src/portal/routes.tsx, src/layouts/App.astro); no attribute means "the device decides".
 * IntelForm adds the Owner's "light / dark default" (App settings → `defaultMode`): it applies
 * only while the member has not picked a theme themselves. (Legacy used a `.dark` class and its
 * own ThemeProvider; both are gone.)
 */

export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

/** The template's key for the member's own choice. Read only: the top bar writes it. */
export const MEMBER_THEME_KEY = 'site:theme';
/** The Owner's default, cached so the next visit can apply it early. */
export const APP_DEFAULT_THEME_KEY = 'intelform:theme-default';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    // Storage can be blocked (private mode).
    return null;
  }
}

/** The member's own pick, or null when they left it to the device (or the app default). */
export function memberTheme(): ResolvedTheme | null {
  const v = read(MEMBER_THEME_KEY);
  return v === 'light' || v === 'dark' ? v : null;
}

/**
 * Applies the Owner's default mode unless the member picked a theme. Call when App settings load
 * (`useBranding` does). Returns true when it changed `<html data-theme>`.
 */
export function applyAppDefaultTheme(mode: ThemePreference, root: HTMLElement = document.documentElement): boolean {
  try {
    localStorage.setItem(APP_DEFAULT_THEME_KEY, mode);
  } catch {
    // Not cached; it still applies for this visit.
  }
  if (memberTheme()) return false;
  const before = root.dataset.theme;
  if (mode === 'system') delete root.dataset.theme;
  else root.dataset.theme = mode;
  return before !== root.dataset.theme;
}
