import {EmptyState, PageHeader} from '../../ui';

/**
 * `/forms/$formId/share`: link, embed, QR code, publish state.
 *
 * STUB (IntelForm migration scaffold): the route, nav item and title are wired in
 * src/portal/routes.tsx; the owning agent replaces this body with the real screen
 * (docs/agent/ui.md: PageHeader, Cards, DataTable, loading / empty / error states).
 */
export function ShareTab() {
  return (
    <div className="app-page screen-share">
      <PageHeader title="Share" description="The form's link, embed code and QR code." />
      <EmptyState icon="share" title="Coming soon">
        This part of IntelForm is being moved over.
      </EmptyState>
    </div>
  );
}
