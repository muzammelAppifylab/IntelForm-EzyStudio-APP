import {EmptyState, PageHeader} from '../../ui';

/**
 * `/forms/$formId/build`: the field palette, the canvas and the field panel (logic included).
 *
 * STUB (IntelForm migration scaffold): the route, nav item and title are wired in
 * src/portal/routes.tsx; the owning agent replaces this body with the real screen
 * (docs/agent/ui.md: PageHeader, Cards, DataTable, loading / empty / error states).
 */
export function BuildTab() {
  return (
    <div className="app-page screen-builder-build">
      <PageHeader title="Build" description="Add, arrange and set up the questions." />
      <EmptyState icon="layers" title="Coming soon">
        This part of IntelForm is being moved over.
      </EmptyState>
    </div>
  );
}
