import {type ReactNode, type RefObject, useEffect, useLayoutEffect, useRef} from 'react';

import '../styles/intelform/respondent.css';
import {themeToVars, type FormTheme} from '../lib/intelform/form/theme-core';
import {loadThemeFonts} from './fonts';
import {cx} from './util';

export type ShellMode = 'page' | 'embed' | 'preview';

/**
 * The themed root (`.rf-theme`): background colour or image with its darken overlay, the logo,
 * and a size container so the layouts use container queries (they work the same inside the
 * builder preview as on a phone). `page` fills the dynamic viewport; `embed` takes its content
 * height (the parent iframe resizes to it); `preview` fills its parent.
 *
 * The theme's custom properties (themeToVars) are set through the CSSOM in a layout effect:
 * never a `style=""` attribute, which the CSP refuses. The public page's server render also
 * writes them in a hashed <style> (src/respondent/theme-css.ts), so the first paint is themed.
 */
export function FormShell({
  theme,
  mode,
  transparent,
  device,
  children,
  className,
}: {
  theme: FormTheme;
  mode: ShellMode;
  transparent?: boolean;
  device?: 'desktop' | 'mobile';
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => loadThemeFonts(theme), [theme]);
  useThemeVars(ref, theme);
  useKeyboardInset(ref, mode === 'page');
  const image = theme.background.type === 'image' && !transparent;
  const logo = theme.logo;
  return (
    <div
      ref={ref}
      data-mode={mode}
      data-device={device}
      className={cx(
        'rf-theme',
        `rf-mode-${mode}`,
        mode === 'preview' && device === 'mobile' && 'rf-device-mobile',
        transparent && 'rf-transparent',
        theme.alignment === 'center' && 'rf-align-center',
        className
      )}
    >
      {image && (
        <>
          <div aria-hidden className="rf-bg-image" />
          <div aria-hidden className="rf-bg-overlay" />
        </>
      )}
      {logo && (
        <div className={cx('rf-logo', logo.position === 'center' && 'rf-logo-center')}>
          <img src={logo.url} alt={logo.alt ?? ''} className="rf-logo-img" />
        </div>
      )}
      {children}
    </div>
  );
}

/** Applies a theme's custom properties to an element (CSSOM, allowed by the CSP). */
export function applyThemeVars(el: HTMLElement, theme: FormTheme): void {
  for (const [name, value] of Object.entries(themeToVars(theme))) el.style.setProperty(name, value);
}

function useThemeVars(ref: RefObject<HTMLDivElement | null>, theme: FormTheme) {
  useLayoutEffect(() => {
    if (ref.current) applyThemeVars(ref.current, theme);
  }, [ref, theme]);
}

/**
 * On-screen keyboards: `--kb` is how much of the layout viewport the keyboard covers (iOS doesn't
 * resize the layout viewport), so fixed controls can sit above it. Focused inputs scroll to the
 * middle on touch devices.
 */
function useKeyboardInset(ref: RefObject<HTMLDivElement | null>, on: boolean) {
  useLayoutEffect(() => {
    const vv = window.visualViewport;
    const el = ref.current;
    if (!on || !vv || !el) return;
    const update = () => {
      const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      el.style.setProperty('--kb', `${Math.round(inset)}px`);
    };
    const coarse = matchMedia('(pointer: coarse)').matches;
    let timer: number | undefined;
    const onFocus = (e: FocusEvent) => {
      const t = e.target as HTMLElement;
      if (!coarse || !t.matches('input, textarea, select')) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => t.scrollIntoView({block: 'center'}), 300);
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    el.addEventListener('focusin', onFocus);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
      el.removeEventListener('focusin', onFocus);
      window.clearTimeout(timer);
    };
  }, [ref, on]);
}
