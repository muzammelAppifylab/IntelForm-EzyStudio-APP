import type {IconName} from '../../ui';

/**
 * The builder's five tabs; the tab lives in the URL (/dashboard/forms/<id>/<tab>), one child
 * route each in src/portal/routes.tsx.
 */
export const TABS = [
  {id: 'build', label: 'Build', icon: 'layers', to: '/forms/$formId/build'},
  {id: 'design', label: 'Design', icon: 'palette', to: '/forms/$formId/design'},
  {id: 'settings', label: 'Settings', icon: 'settings', to: '/forms/$formId/settings'},
  {id: 'share', label: 'Share', icon: 'share', to: '/forms/$formId/share'},
  {id: 'responses', label: 'Responses', icon: 'bar-chart', to: '/forms/$formId/responses'},
] as const satisfies readonly {id: string; label: string; icon: IconName; to: string}[];

export type TabId = (typeof TABS)[number]['id'];

/** The tab a dashboard path is on (`/dashboard/forms/<id>/design` → design); null when none. */
export function tabFromPath(pathname: string): TabId | null {
  const last = pathname.replace(/\/+$/, '').split('/').at(-1) ?? '';
  return TABS.find(t => t.id === last)?.id ?? null;
}
