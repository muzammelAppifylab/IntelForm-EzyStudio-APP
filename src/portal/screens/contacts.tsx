import {EmptyState, PageHeader} from '../ui';

/**
 * `/contacts`: contacts gathered from responses (search, details, export).
 *
 * STUB (IntelForm migration scaffold): the route, nav item and title are wired in
 * src/portal/routes.tsx; the owning agent replaces this body with the real screen
 * (docs/agent/ui.md: PageHeader, Cards, DataTable, loading / empty / error states).
 */
export function Contacts() {
  return (
    <div className="app-page screen-contacts">
      <PageHeader title="Contacts" description="People who answered your forms with their contact details." />
      <EmptyState icon="contact" title="Coming soon">
        This part of IntelForm is being moved over.
      </EmptyState>
    </div>
  );
}
