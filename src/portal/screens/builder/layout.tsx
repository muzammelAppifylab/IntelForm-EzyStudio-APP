import {Link, Outlet, useParams} from '@tanstack/react-router';

import {buttonClass, Icon, type IconName} from '../../ui';

/**
 * `/forms/$formId/*`: one form's builder. The header (back to the forms, the form's
 * name, its tabs) stays put while the tab below changes: build, design, settings,
 * share, responses (child routes in src/portal/routes.tsx; `/forms/$formId` alone
 * opens `build`).
 *
 * STUB (IntelForm migration scaffold): the builder agent replaces the header with the
 * real one (the form's title and status, publish, preview, save state) and keeps
 * `<Outlet />` for the tabs.
 */
const TABS = [
  {to: '/forms/$formId/build', label: 'Build', icon: 'layers'},
  {to: '/forms/$formId/design', label: 'Design', icon: 'palette'},
  {to: '/forms/$formId/settings', label: 'Settings', icon: 'settings'},
  {to: '/forms/$formId/share', label: 'Share', icon: 'share'},
  {to: '/forms/$formId/responses', label: 'Responses', icon: 'bar-chart'},
] as const satisfies readonly {to: string; label: string; icon: IconName}[];

export function BuilderLayout() {
  const {formId} = useParams({from: '/forms/$formId'});
  return (
    <div className="screen-builder">
      <div className="builder-head">
        <Link className={buttonClass({variant: 'ghost', size: 'sm'})} to="/forms">
          <Icon name="arrow-left" size={16} />
          All forms
        </Link>
        <nav className="builder-tabs" aria-label="Form sections">
          {TABS.map(tab => (
            <Link key={tab.to} to={tab.to} params={{formId}} className="builder-tab">
              <Icon name={tab.icon} size={16} />
              {tab.label}
            </Link>
          ))}
        </nav>
      </div>
      <Outlet />
    </div>
  );
}
