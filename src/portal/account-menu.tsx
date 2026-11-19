import {useNavigate} from '@tanstack/react-router';
import {useEffect, useState} from 'react';

import {logout} from '../platform/browser';
import {useMe} from './shared';
import {Avatar, Icon, Menu, type MenuItem} from './ui';

export type Theme = 'system' | 'light' | 'dark';
const THEME_KEY = 'site:theme';
const THEME_ICON = {light: 'sun', dark: 'moon', system: 'monitor'} as const;

/** Light, dark or the device's: `data-theme` on <html> (global.css), remembered in this browser. */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      return saved === 'light' || saved === 'dark' ? saved : 'system';
    } catch {
      return 'system';
    }
  });
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') delete root.dataset.theme;
    else root.dataset.theme = theme;
    try {
      if (theme === 'system') localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, theme);
    } catch {
      // Storage blocked: the choice lasts until the tab closes.
    }
  }, [theme]);
  return [theme, setTheme] as const;
}

/** The top bar's theme switcher: a bare icon opening Light / Dark / Same as this device. */
export function ThemeMenu() {
  const [theme, setTheme] = useTheme();
  return (
    <Menu
      label={`Theme: ${theme}`}
      trigger={<Icon name={THEME_ICON[theme]} size={18} />}
      items={[
        {label: 'Light', icon: 'sun', onSelect: () => setTheme('light')},
        {label: 'Dark', icon: 'moon', onSelect: () => setTheme('dark')},
        {label: 'Same as this device', icon: 'monitor', onSelect: () => setTheme('system')},
      ]}
    />
  );
}

/**
 * The signed-in person's menu: their account, the website, sign out. `compact` shows only the
 * avatar (the form builder's header) and adds the theme choices, which have no button of their
 * own there.
 */
export function AccountMenu({compact = false}: {compact?: boolean}) {
  const me = useMe();
  const navigate = useNavigate();
  const [theme, setTheme] = useTheme();
  // `logout()` reloads the page when it is done, so pending never needs resetting.
  const [signingOut, setSigningOut] = useState(false);
  const viewer = me.data?.viewer;
  if (!viewer || viewer.state !== 'user') return null;

  const themeItems: MenuItem[] = compact
    ? [
        'separator',
        ...(['light', 'dark', 'system'] as const).map(value => ({
          label: value === 'light' ? 'Light theme' : value === 'dark' ? 'Dark theme' : 'Theme like this device',
          icon: theme === value ? ('check' as const) : THEME_ICON[value],
          onSelect: () => setTheme(value),
        })),
      ]
    : [];

  return (
    <Menu
      label={`Account menu for ${viewer.name ?? 'you'}`}
      trigger={
        <>
          {signingOut ? <span className="spinner" aria-hidden="true" /> : <Avatar name={viewer.name ?? ''} size="sm" />}
          {!compact && <span className="app-viewer-name">{signingOut ? 'Signing out…' : viewer.name}</span>}
          <Icon name="chevron-down" size={16} />
        </>
      }
      disabled={signingOut}
      items={[
        {label: 'Your account', icon: 'user', onSelect: () => void navigate({to: '/account'})},
        {label: 'Back to the website', icon: 'globe', onSelect: () => window.location.assign('/')},
        ...themeItems,
        'separator',
        {
          label: 'Sign out',
          icon: 'log-out',
          onSelect: () => {
            setSigningOut(true);
            void logout();
          },
        },
      ]}
    />
  );
}
