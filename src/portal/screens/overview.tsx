import {Link} from '@tanstack/react-router';

import {useMe, useSite} from '../shared';
import {buttonClass, Card, EmptyState, ErrorNote, Icon, PageHeader} from '../ui';

/**
 * `/` of the dashboard: IntelForm's overview (a greeting, the numbers that matter,
 * recent forms and responses).
 *
 * STUB (IntelForm migration scaffold): the overview agent replaces the body with
 * StatCards (cheap numbers only: a first page or a counter kept on write, never a
 * count per request; docs/agent/performance.md), recent forms and recent responses.
 * Keep the export name: src/portal/routes.tsx loads it lazily by name.
 */
export function Overview() {
  const me = useMe();
  const site = useSite();
  const abilities = me.data?.abilities;
  const firstName = me.data?.viewer?.name?.split(/\s+/)[0];
  return (
    <div className="app-page screen-overview">
      <PageHeader
        title={firstName ? `Welcome back, ${firstName}` : 'Welcome back'}
        description={`Your forms and their responses on ${site.data?.site?.name ?? 'your site'}.`}
        actions={
          abilities?.viewForms ? (
            <Link className={buttonClass()} to="/forms">
              <Icon name="form" size={18} />
              Your forms
            </Link>
          ) : undefined
        }
      />
      {me.error && <ErrorNote error={me.error} />}
      <Card>
        <EmptyState icon="dashboard" title="Coming soon">
          Your numbers, recent forms and the latest responses will show here.
        </EmptyState>
      </Card>
    </div>
  );
}
