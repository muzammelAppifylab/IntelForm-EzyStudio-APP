import type {QueryClient} from '@tanstack/react-query';
import {
  createRootRouteWithContext,
  createRoute,
  type ErrorComponentProps,
  Link,
  lazyRouteComponent,
  Outlet,
  redirect,
  useMatches,
  useRouter,
  useRouterState,
} from '@tanstack/react-router';
import {useEffect, useRef, useState} from 'react';

import type {Abilities} from '../lib/types';
import {
  activityFilterOf,
  activityPeopleQuery,
  activityQuery,
  meQuery,
  permissionsQuery,
  readActivitySearch,
  rolesQuery,
  sessionsQuery,
  siteQuery,
  twoFactorQuery,
  usersQuery,
} from './queries';
import {AccountMenu, ThemeMenu} from './account-menu';
import {useMe, useSite} from './shared';
import {appSettingsQuery} from './intelform/queries/app-settings';
import {contactsListQuery, contactsOverviewQuery, DEFAULT_CONTACTS_STATE} from './intelform/queries/contacts';
import {DEFAULT_FORMS_FILTER, formsListQuery, formsStripQuery, recentFormsQuery} from './intelform/queries/forms';
import {templatesQuery} from './intelform/queries/templates';
import {
  Button,
  buttonClass,
  ConfirmProvider,
  EmptyState,
  Icon,
  IconButton,
  type IconName,
  initials,
  LoadingBlock,
  ToastProvider,
} from './ui';

/**
 * The portal's screens: a TanStack Router app under `/dashboard` (basepath),
 * served by `src/pages/portal/[...path].astro` (signed-in users only), with
 * data from the Site API through TanStack Query. Links INSIDE the portal use
 * `<Link>`; links to the website (`/`, `/blog/`, `/account/…`) are plain
 * `<a href>`.
 *
 * Add a screen (all five, every time):
 *   1. its reads as `queryOptions` in `queries.ts`, used by the screen with `useQuery(x)`;
 *   2. the component in `screens/<name>.tsx` (a named export);
 *   3. a `createRoute` below: literal `path`, `staticData.title` (the top bar
 *      and the tab), a `loader` that warms its queries, and the component
 *      LAZY (`lazyRouteComponent(() => import('./screens/<name>'), 'Name')`)
 *      so its code loads on first use (or on hover), never in the first bundle;
 *   4. its route in `routeTree`;
 *   5. one item in `NAV_GROUPS` if it belongs in the sidebar.
 * Never a plain `<a href>` to a portal path: it reloads the whole app.
 */

declare module '@tanstack/react-router' {
  interface StaticDataRouteOption {
    /** The screen's name: the top bar's `<h1>` and the tab's title. */
    title?: string;
  }
}

/**
 * Warm a screen's queries before it renders (on navigation, and on hover via
 * `defaultPreload: 'intent'`). A failed read is NOT thrown: the screen shows
 * the error in place from the same query, as it always has.
 */
const warm = (...reads: Promise<unknown>[]) => Promise.all(reads.map(read => read.catch(() => undefined))).then(() => undefined);

/** While a slow screen loads (after `defaultPendingMs`). */
export function RoutePending() {
  return (
    <div className="app-page">
      <LoadingBlock rows={4} />
    </div>
  );
}

/** A screen that failed to render or to load its code (an old tab after a Publish: reload). */
export function RouteError({error}: ErrorComponentProps) {
  const router = useRouter();
  const failure = error instanceof Error ? error : new Error('Something went wrong.');
  const stale = /dynamically imported module|module script|Importing a module/i.test(failure.message);
  return (
    <div className="app-page">
      <EmptyState
        icon={stale ? 'refresh' : 'alert'}
        title={stale ? 'This dashboard was updated' : 'This screen could not load'}
        action={
          <Button variant="secondary" icon="refresh" onClick={() => (stale ? window.location.reload() : void router.invalidate())}>
            {stale ? 'Reload' : 'Try again'}
          </Button>
        }>
        {stale ? 'Reload to get the new version.' : failure.message}
      </EmptyState>
    </div>
  );
}

/** `ability` names a flag of `/me`'s `abilities` (src/server/permissions.ts CATALOGUE). */
type NavItem = {to: string; label: string; icon: IconName; exact?: boolean; ability?: keyof Abilities};

/**
 * The sidebar, in groups. `ability` hides an item the visitor may not use;
 * that only HIDES it, the route's guard is the enforcement. A group with no
 * visible item is not shown.
 */
const NAV_GROUPS: {label: string; items: NavItem[]}[] = [
  {
    label: 'Workspace',
    items: [
      {to: '/', label: 'Overview', icon: 'dashboard', exact: true},
      {to: '/forms', label: 'Forms', icon: 'form', ability: 'viewForms'},
      {to: '/templates', label: 'Templates', icon: 'template', ability: 'editForms'},
      {to: '/contacts', label: 'Contacts', icon: 'contact', ability: 'viewContacts'},
    ],
  },
  {
    label: 'Manage',
    items: [
      {to: '/app-settings', label: 'Settings', icon: 'settings', ability: 'manageAppSettings'},
      {to: '/users', label: 'Users', icon: 'users', ability: 'manageUsers'},
      {to: '/roles', label: 'Roles', icon: 'shield', ability: 'manageRoles'},
      {to: '/activity', label: 'Activity', icon: 'activity', ability: 'readAudit'},
    ],
  },
  {
    label: 'You',
    items: [{to: '/account', label: 'Your account', icon: 'user'}],
  },
];

/** The screen's title for the top bar and the tab: the deepest route's `staticData.title`. */
function useScreenTitle() {
  const matches = useMatches();
  return [...matches].reverse().find(match => match.staticData.title)?.staticData.title ?? 'Dashboard';
}

/**
 * After every in-app navigation (never the first load): the tab title says
 * where you are, and focus moves to the screen's `<h1>` so keyboard and
 * screen reader users start at the new screen (it is read out), as after a
 * page load.
 */
function useNavigationFocus(title: string, siteName: string | undefined) {
  const heading = useRef<HTMLHeadingElement>(null);
  const resolved = useRouterState({select: s => s.resolvedLocation?.pathname});
  const first = useRef(true);
  // "<title> · <site>", as App.astro writes it on the first load.
  const [fallbackName] = useState(() => document.title.split(' · ').slice(1).join(' · ') || 'IntelForm');
  useEffect(() => {
    document.title = `${title} · ${siteName ?? fallbackName}`;
  }, [title, siteName, fallbackName]);
  useEffect(() => {
    if (!resolved) return;
    if (first.current) {
      first.current = false;
      return;
    }
    heading.current?.focus({preventScroll: true});
  }, [resolved]);
  return {heading, resolved};
}

/**
 * The app shell: a full-height sidebar (brand, grouped nav, way back to the
 * website), a top bar (screen title, theme, the user's menu) and the screen
 * in between; a drawer with a scrim on small screens. Every screen renders
 * inside it, with toasts (`useToast`) and confirmations (`useConfirm`)
 * mounted once here. Nothing here reloads the page.
 */
const rootRoute = createRootRouteWithContext<{queryClient: QueryClient}>()({
  component: function Root() {
    return (
      <ToastProvider>
        <ConfirmProvider>
          <Shell />
        </ConfirmProvider>
      </ToastProvider>
    );
  },
  notFoundComponent: () => (
    <div className="app-page">
      <EmptyState
        icon="search"
        title="This page does not exist"
        action={
          <Link className={buttonClass({variant: 'secondary'})} to="/">
            Back to the overview
          </Link>
        }>
        The link may be old, or the page was moved.
      </EmptyState>
    </div>
  ),
});

function Shell() {
  const me = useMe();
  const site = useSite();
  const title = useScreenTitle();
  const siteName = site.data?.site?.name;
  const {heading, resolved} = useNavigationFocus(title, siteName);
  const [open, setOpen] = useState(false);
  // The form builder takes the whole window: no sidebar and no top bar (its own header has the
  // way back and the account menu).
  const fullPage = useRouterState({select: s => s.matches.some(m => m.routeId.startsWith(builderRoute.id))});
  const viewer = me.data?.viewer;
  const abilities = me.data?.abilities;
  // Signed out meanwhile (or never signed in, in the editor Preview, where
  // the host page cannot see the session): go and sign in, then come back.
  const signedOut = viewer !== undefined && viewer.state !== 'user';
  useEffect(() => {
    if (!signedOut) return;
    const back = encodeURIComponent(`${window.location.pathname}${window.location.search}`);
    window.location.replace(`/account/login/?next=${back}`);
  }, [signedOut]);
  // The drawer closes on navigation and on Esc.
  useEffect(() => setOpen(false), [resolved]);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);
  if (signedOut) return null;

  const name = siteName ?? 'IntelForm';
  const logo = site.data?.site?.logo;
  return (
    <div className="app-shell" data-nav-open={open ? '' : undefined} data-full-page={fullPage ? '' : undefined}>
      {!fullPage && (
      <aside className="app-sidebar" aria-label="Sidebar">
        <a className="app-brand" href="/">
          <span className="app-brand-mark">{logo ? <img src={logo} alt="" /> : initials(name) || '·'}</span>
          <span className="app-brand-name">{name}</span>
        </a>
        <nav className="app-nav" aria-label="Dashboard">
          {NAV_GROUPS.map(group => {
            const items = group.items.filter(item => !item.ability || abilities?.[item.ability]);
            if (!items.length) return null;
            return (
              <div className="app-nav-group" key={group.label}>
                <p className="app-nav-label">{group.label}</p>
                {items.map(item => (
                  <Link key={item.to} to={item.to} className="app-nav-link" activeOptions={{exact: item.exact ?? false}}>
                    <Icon name={item.icon} size={18} />
                    {item.label}
                  </Link>
                ))}
              </div>
            );
          })}
        </nav>
        <div className="app-sidebar-foot">
          <a className="app-nav-link" href="/">
            <Icon name="arrow-left" size={18} />
            Back to the website
          </a>
        </div>
      </aside>
      )}
      {!fullPage && (
        <button type="button" className="app-scrim" aria-label="Close the menu" tabIndex={-1} onClick={() => setOpen(false)} />
      )}

      <div className="app-main">
        {fullPage ? (
          // No top bar here, but the screen still has its <h1> for the focus move after navigation.
          <h1 className="visually-hidden" ref={heading} tabIndex={-1}>
            {title}
          </h1>
        ) : (
          <header className="app-topbar">
            <IconButton
              className="app-menu-button"
              icon={open ? 'x' : 'menu'}
              label={open ? 'Close the menu' : 'Open the menu'}
              aria-expanded={open}
              onClick={() => setOpen(value => !value)}
            />
            <h1 className="app-title" ref={heading} tabIndex={-1}>
              {title}
            </h1>
            <div className="app-topbar-actions">
              <ThemeMenu />
              <AccountMenu />
            </div>
          </header>
        )}
        <main className="app-content" id="main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

// One `createRoute` per screen, with a LITERAL path (`<Link to>` is typed from
// them), a title, a loader over the screen's own queryOptions, a lazy screen.
const overviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  staticData: {title: 'Overview'},
  loader: ({context: {queryClient}}) =>
    warm(
      queryClient.ensureQueryData(meQuery),
      queryClient.ensureQueryData(siteQuery),
      queryClient.ensureQueryData(formsStripQuery),
      queryClient.ensureQueryData(recentFormsQuery)
    ),
  component: lazyRouteComponent(() => import('./screens/overview'), 'Overview'),
});
const accountRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/account',
  staticData: {title: 'Your account'},
  // `?tab=security`: a link can open one section of the account screen.
  validateSearch: (search: Record<string, unknown>): {tab?: string} =>
    typeof search.tab === 'string' ? {tab: search.tab} : {},
  loader: ({context: {queryClient}}) =>
    warm(
      queryClient.ensureQueryData(meQuery),
      queryClient.ensureQueryData(twoFactorQuery),
      queryClient.ensureQueryData(sessionsQuery)
    ),
  component: lazyRouteComponent(() => import('./screens/account'), 'Account'),
});
// ------------------------------------------------------------------ IntelForm --
// Each loader warms the screen's own queries from ./intelform/queries/<domain>.ts.
const formsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/forms',
  staticData: {title: 'Forms'},
  loader: ({context: {queryClient}}) =>
    warm(queryClient.ensureInfiniteQueryData(formsListQuery(DEFAULT_FORMS_FILTER)), queryClient.ensureQueryData(formsStripQuery)),
  component: lazyRouteComponent(() => import('./screens/forms'), 'Forms'),
});
const templatesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/templates',
  staticData: {title: 'Templates'},
  loader: ({context: {queryClient}}) => warm(queryClient.ensureQueryData(templatesQuery)),
  component: lazyRouteComponent(() => import('./screens/templates'), 'Templates'),
});
const contactsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/contacts',
  staticData: {title: 'Contacts'},
  loader: ({context: {queryClient}}) =>
    warm(
      queryClient.ensureInfiniteQueryData(contactsListQuery(DEFAULT_CONTACTS_STATE)),
      queryClient.ensureQueryData(contactsOverviewQuery)
    ),
  component: lazyRouteComponent(() => import('./screens/contacts'), 'Contacts'),
});
const appSettingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/app-settings',
  staticData: {title: 'Settings'},
  // `?tab=data`: a link can open one tab of the settings screen.
  validateSearch: (search: Record<string, unknown>): {tab?: string} =>
    typeof search.tab === 'string' ? {tab: search.tab} : {},
  loader: ({context: {queryClient}}) => warm(queryClient.ensureQueryData(appSettingsQuery)),
  component: lazyRouteComponent(() => import('./screens/app-settings'), 'AppSettings'),
});

// One form's builder: a layout (header + tabs) with a child route per tab; the bare
// `/forms/$formId` opens the Build tab.
const builderRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/forms/$formId',
  staticData: {title: 'Form'},
  component: lazyRouteComponent(() => import('./screens/builder/layout'), 'BuilderLayout'),
});
const builderIndexRoute = createRoute({
  getParentRoute: () => builderRoute,
  path: '/',
  beforeLoad: ({params}) => {
    throw redirect({to: '/forms/$formId/build', params, replace: true});
  },
});
const buildRoute = createRoute({
  getParentRoute: () => builderRoute,
  path: 'build',
  staticData: {title: 'Build'},
  component: lazyRouteComponent(() => import('./screens/builder/build'), 'BuildTab'),
});
const designRoute = createRoute({
  getParentRoute: () => builderRoute,
  path: 'design',
  staticData: {title: 'Design'},
  component: lazyRouteComponent(() => import('./screens/builder/design'), 'DesignTab'),
});
const formSettingsRoute = createRoute({
  getParentRoute: () => builderRoute,
  path: 'settings',
  staticData: {title: 'Form settings'},
  component: lazyRouteComponent(() => import('./screens/builder/settings'), 'SettingsTab'),
});
const shareRoute = createRoute({
  getParentRoute: () => builderRoute,
  path: 'share',
  staticData: {title: 'Share'},
  component: lazyRouteComponent(() => import('./screens/builder/share'), 'ShareTab'),
});
const responsesRoute = createRoute({
  getParentRoute: () => builderRoute,
  path: 'responses',
  staticData: {title: 'Responses'},
  component: lazyRouteComponent(() => import('./screens/builder/responses'), 'ResponsesTab'),
});
const usersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/users',
  staticData: {title: 'Users'},
  loader: ({context: {queryClient}}) => warm(queryClient.ensureInfiniteQueryData(usersQuery({email: '', status: ''}))),
  component: lazyRouteComponent(() => import('./screens/users'), 'Users'),
});
const rolesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/roles',
  staticData: {title: 'Roles'},
  loader: ({context: {queryClient}}) =>
    warm(queryClient.ensureQueryData(rolesQuery), queryClient.ensureQueryData(permissionsQuery)),
  component: lazyRouteComponent(() => import('./screens/roles'), 'Roles'),
});
const activityRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/activity',
  staticData: {title: 'Activity'},
  // `?kind=forms&person=12&from=2026-11-01&to=2026-11-18`: a filtered view is a link you can share.
  validateSearch: readActivitySearch,
  loaderDeps: ({search}) => activityFilterOf(search),
  loader: ({context: {queryClient}, deps}) =>
    warm(queryClient.ensureQueryData(activityQuery(deps)), queryClient.ensureQueryData(activityPeopleQuery)),
  component: lazyRouteComponent(() => import('./screens/activity'), 'Activity'),
});

export const routeTree = rootRoute.addChildren([
  overviewRoute,
  accountRoute,
  formsRoute,
  templatesRoute,
  contactsRoute,
  appSettingsRoute,
  builderRoute.addChildren([builderIndexRoute, buildRoute, designRoute, formSettingsRoute, shareRoute, responsesRoute]),
  usersRoute,
  rolesRoute,
  activityRoute,
]);
