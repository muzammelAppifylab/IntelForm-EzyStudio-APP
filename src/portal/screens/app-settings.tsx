import {EmptyState, PageHeader} from '../ui';

/**
 * `/app-settings`: IntelForm's app-wide settings (admins).
 *
 * STUB (IntelForm migration scaffold): the route, nav item and title are wired in
 * src/portal/routes.tsx; the owning agent replaces this body with the real screen
 * (docs/agent/ui.md: PageHeader, Cards, DataTable, loading / empty / error states).
 */
export function AppSettings() {
  return (
    <div className="app-page screen-app-settings">
      <PageHeader title="Settings" description="How IntelForm works across the whole site." />
      <EmptyState icon="settings" title="Coming soon">
        This part of IntelForm is being moved over.
      </EmptyState>
    </div>
  );
}
