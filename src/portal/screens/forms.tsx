import {EmptyState, PageHeader} from '../ui';

/**
 * `/forms`: every form (list, search, filter by status), create, duplicate, close, delete.
 *
 * STUB (IntelForm migration scaffold): the route, nav item and title are wired in
 * src/portal/routes.tsx; the owning agent replaces this body with the real screen
 * (docs/agent/ui.md: PageHeader, Cards, DataTable, loading / empty / error states).
 */
export function Forms() {
  return (
    <div className="app-page screen-forms">
      <PageHeader title="Forms" description="Every form, its status and its latest responses." />
      <EmptyState icon="form" title="Coming soon">
        This part of IntelForm is being moved over.
      </EmptyState>
    </div>
  );
}
