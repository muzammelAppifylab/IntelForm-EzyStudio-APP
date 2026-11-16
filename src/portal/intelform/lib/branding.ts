import {queryOptions, useQuery} from '@tanstack/react-query';
import {useEffect} from 'react';

import type {PublicAppInfo} from '../../../lib/intelform/api-front';
import {contrastRatio} from '../../../lib/intelform/form/theme';
import {api} from './api';
import {applyAppDefaultTheme} from './theme';

/**
 * IntelForm's App settings branding (name, favicon, accent colour, default mode), public and
 * cached: GET /site-api/public-site/app. Shared by the dashboard shell and the public pages.
 */
export const appInfoQuery = queryOptions({
  queryKey: ['intelform', 'app-info'],
  queryFn: () => api<PublicAppInfo>('/site-api/public-site/app'),
  staleTime: 5 * 60_000,
});

/** The template tokens the accent colour overrides (src/styles/global.css). */
const ACCENT_VARS = ['--accent', '--accent-hover', '--accent-ink', '--accent-soft', '--accent-text'] as const;

/** Dark ink for text on a light accent (the light theme's `--ink`). */
const INK = '#0e0f0f';
const HEX = /^#[0-9a-f]{6}$/i;

/** What a custom accent sets, for `style.setProperty` (pure, so it is tested). */
export function accentTokens(color: string): Record<(typeof ACCENT_VARS)[number], string> | null {
  if (!HEX.test(color)) return null;
  const onAccent = contrastRatio(color, '#FFFFFF') >= contrastRatio(color, INK) ? '#ffffff' : INK;
  return {
    '--accent': color,
    '--accent-hover': `color-mix(in oklab, ${color} 85%, ${onAccent === '#ffffff' ? '#000000' : '#ffffff'})`,
    '--accent-ink': onAccent,
    '--accent-soft': `color-mix(in oklab, ${color} 18%, var(--card))`,
    '--accent-text': `color-mix(in oklab, ${color} 75%, var(--ink))`,
  };
}

/**
 * Applies App settings branding: the favicon everywhere, and (when `accent` is set) the
 * dashboard accent colour over the template's `--accent` tokens. Text on the accent picks white
 * or ink, whichever contrasts more. The light / dark default applies to members who haven't
 * picked a theme themselves. Inline custom properties are set through `element.style` in an
 * effect, which the CSP allows (ui.md).
 */
export function useBranding({accent}: {accent: boolean}) {
  const {data: app} = useQuery(appInfoQuery);

  useEffect(() => {
    if (app?.defaultMode) applyAppDefaultTheme(app.defaultMode);
  }, [app?.defaultMode]);

  useEffect(() => {
    if (!app?.faviconUrl) return;
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!link) return;
    const previous = link.href;
    const previousType = link.getAttribute('type');
    link.href = app.faviconUrl;
    link.removeAttribute('type');
    return () => {
      link.href = previous;
      if (previousType) link.setAttribute('type', previousType);
    };
  }, [app?.faviconUrl]);

  useEffect(() => {
    const tokens = accent && app?.accentColor ? accentTokens(app.accentColor) : null;
    if (!tokens) return;
    const root = document.documentElement.style;
    for (const [name, value] of Object.entries(tokens)) root.setProperty(name, value);
    return () => ACCENT_VARS.forEach(v => root.removeProperty(v));
  }, [accent, app?.accentColor]);
}
