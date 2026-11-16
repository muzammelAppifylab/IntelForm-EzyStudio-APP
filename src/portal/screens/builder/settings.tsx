import {EmptyState, PageHeader} from '../../ui';

/**
 * `/forms/$formId/settings`: one form's settings.
 *
 * STUB (IntelForm migration scaffold): the route, nav item and title are wired in
 * src/portal/routes.tsx; the owning agent replaces this body with the real screen
 * (docs/agent/ui.md: PageHeader, Cards, DataTable, loading / empty / error states).
 */
export function SettingsTab() {
  return (
    <div className="app-page screen-form-settings">
      <PageHeader title="Settings" description="Who can answer, when the form closes, notifications and webhooks." />
      <EmptyState icon="settings" title="Coming soon">
        This part of IntelForm is being moved over.
      </EmptyState>
    </div>
  );
}
