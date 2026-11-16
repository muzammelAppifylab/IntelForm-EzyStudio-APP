import {EmptyState, PageHeader} from '../../ui';

/**
 * `/forms/$formId/responses`: the responses table, summaries and export.
 *
 * STUB (IntelForm migration scaffold): the route, nav item and title are wired in
 * src/portal/routes.tsx; the owning agent replaces this body with the real screen
 * (docs/agent/ui.md: PageHeader, Cards, DataTable, loading / empty / error states).
 */
export function ResponsesTab() {
  return (
    <div className="app-page screen-responses">
      <PageHeader title="Responses" description="Every answer, a summary per question, and exports." />
      <EmptyState icon="bar-chart" title="Coming soon">
        This part of IntelForm is being moved over.
      </EmptyState>
    </div>
  );
}
