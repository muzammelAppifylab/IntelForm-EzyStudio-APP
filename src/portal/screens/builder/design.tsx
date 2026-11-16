import {EmptyState, PageHeader} from '../../ui';

/**
 * `/forms/$formId/design`: the form's theme and layout, with a live preview.
 *
 * STUB (IntelForm migration scaffold): the route, nav item and title are wired in
 * src/portal/routes.tsx; the owning agent replaces this body with the real screen
 * (docs/agent/ui.md: PageHeader, Cards, DataTable, loading / empty / error states).
 */
export function DesignTab() {
  return (
    <div className="app-page screen-design">
      <PageHeader title="Design" description="Layout, colours, fonts and the welcome and thank-you screens." />
      <EmptyState icon="palette" title="Coming soon">
        This part of IntelForm is being moved over.
      </EmptyState>
    </div>
  );
}
