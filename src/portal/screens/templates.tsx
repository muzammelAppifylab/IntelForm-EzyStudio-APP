import {EmptyState, PageHeader} from '../ui';

/**
 * `/templates`: the template gallery and the forms saved as templates.
 *
 * STUB (IntelForm migration scaffold): the route, nav item and title are wired in
 * src/portal/routes.tsx; the owning agent replaces this body with the real screen
 * (docs/agent/ui.md: PageHeader, Cards, DataTable, loading / empty / error states).
 */
export function Templates() {
  return (
    <div className="app-page screen-templates">
      <PageHeader title="Templates" description="Start a form from a ready-made template, or save your own." />
      <EmptyState icon="template" title="Coming soon">
        This part of IntelForm is being moved over.
      </EmptyState>
    </div>
  );
}
