import {useQuery, type UseQueryResult} from '@tanstack/react-query';
import {Link} from '@tanstack/react-router';
import {useState} from 'react';

import {FormBadges, LayoutIcon} from '../intelform/forms/bits';
import {plural} from '../intelform/forms/format';
import {NewFormDrawer} from '../intelform/forms/templates';
import {WeekStats} from '../intelform/forms/week';
import {useAbilities} from '../intelform/lib/can';
import {
  type FormsPage,
  formsStripQuery,
  recentFormsQuery,
  type RecentResponse,
  type RecentResponsesResponse,
  recentResponsesQuery,
} from '../intelform/queries/forms';
import {ago, useMe, useSite, when} from '../shared';
import {Avatar, Button, buttonClass, Card, EmptyState, ErrorNote, Icon, PageHeader, Skeleton} from '../ui';

/** Forms shown under "Recent forms" (the first page of the list, newest edit first). */
const RECENT_FORMS = 5;

/**
 * `/` of the dashboard: IntelForm's overview. A greeting, the week's numbers (one strip read,
 * no count per tile), the forms edited last and the latest responses across every form.
 * Everything is gated by abilities; the routes check again.
 */
export function Overview() {
  const me = useMe();
  const site = useSite();
  const {viewForms, editForms, viewResponses, viewContacts} = useAbilities();
  const [creating, setCreating] = useState(false);
  const firstName = me.data?.viewer?.name?.split(/\s+/)[0];

  const strip = useQuery({...formsStripQuery, enabled: !!viewForms});
  const forms = useQuery({...recentFormsQuery, enabled: !!viewForms});
  const responses = useQuery({...recentResponsesQuery, enabled: !!viewResponses});

  return (
    <div className="app-page screen-overview">
      <PageHeader
        title={firstName ? `Welcome back, ${firstName}` : 'Welcome back'}
        description={`Your forms and their responses on ${site.data?.site?.name ?? 'your site'}.`}
        actions={
          <>
            {viewForms && (
              <Link className={buttonClass({variant: 'secondary'})} to="/forms">
                <Icon name="form" size={18} />
                Your forms
              </Link>
            )}
            {editForms && (
              <Button icon="plus" onClick={() => setCreating(true)}>
                New form
              </Button>
            )}
          </>
        }
      />
      {me.error && <ErrorNote error={me.error} />}

      {!me.data ? (
        <Skeleton lines={4} />
      ) : !viewForms ? (
        <Card>
          <EmptyState icon="dashboard" title="Nothing to show yet">
            Your role doesn’t include forms. Ask an admin if you need to see them.
          </EmptyState>
        </Card>
      ) : (
        <>
          {strip.error ? <ErrorNote error={strip.error} title="The week’s numbers didn’t load" /> : <WeekStats strip={strip.data} />}

          <div className={viewResponses ? 'grid-2' : undefined}>
            <Card
              title="Recent forms"
              description="Last edited first"
              flush
              footer={
                <Link className="if-view-all" to="/forms">
                  View all forms
                  <Icon name="arrow-right" size={16} />
                </Link>
              }>
              <RecentForms query={forms} canCreate={!!editForms} onCreate={() => setCreating(true)} />
            </Card>

            {viewResponses && (
              <Card
                title="Recent responses"
                description="Across every form"
                flush
                footer={
                  viewContacts ? (
                    <Link className="if-view-all" to="/contacts">
                      View all
                      <Icon name="arrow-right" size={16} />
                    </Link>
                  ) : (
                    <Link className="if-view-all" to="/forms">
                      View all
                      <Icon name="arrow-right" size={16} />
                    </Link>
                  )
                }>
                <RecentResponses query={responses} />
              </Card>
            )}
          </div>
        </>
      )}

      {editForms && <NewFormDrawer open={creating} onClose={() => setCreating(false)} />}
    </div>
  );
}

function RowsSkeleton() {
  return (
    <div className="if-rows-skeleton" aria-hidden="true">
      <Skeleton lines={4} />
    </div>
  );
}

function RecentForms({
  query,
  canCreate,
  onCreate,
}: {
  query: UseQueryResult<FormsPage>;
  canCreate: boolean;
  onCreate: () => void;
}) {
  if (query.isPending) return <RowsSkeleton />;
  if (query.error) return <ErrorNote error={query.error} />;
  const rows = query.data.forms.slice(0, RECENT_FORMS);
  if (rows.length === 0) {
    return (
      <EmptyState
        icon="form"
        title="No forms yet"
        action={
          canCreate ? (
            <Button icon="plus" onClick={onCreate}>
              New form
            </Button>
          ) : undefined
        }>
        Forms your team creates show up here, with their responses.
      </EmptyState>
    );
  }
  return (
    <ul className="list if-rows">
      {rows.map(form => (
        <li key={form.id}>
          <LayoutIcon layout={form.layout} size="sm" />
          <span className="if-rows-text">
            <Link to="/forms/$formId/build" params={{formId: form.id}}>
              {form.title}
            </Link>
            <span className="muted">
              {plural(form.responseCount, 'response')} · edited{' '}
              <time dateTime={form.updatedAt} title={when(form.updatedAt)}>
                {ago(form.updatedAt)}
              </time>
            </span>
          </span>
          <FormBadges form={form} />
        </li>
      ))}
    </ul>
  );
}

const who = (r: RecentResponse) => r.contactName?.trim() || r.contactEmail?.trim() || 'Anonymous';

function RecentResponses({query}: {query: UseQueryResult<RecentResponsesResponse>}) {
  if (query.isPending) return <RowsSkeleton />;
  if (query.error) return <ErrorNote error={query.error} />;
  const rows = query.data.responses;
  if (rows.length === 0) {
    return (
      <EmptyState icon="inbox" title="No responses yet">
        Responses show here as people submit your live forms.
      </EmptyState>
    );
  }
  return (
    <ul className="list if-rows">
      {rows.map(r => (
        <li key={r.id}>
          <Avatar name={who(r)} size="sm" />
          <span className="if-rows-text">
            <Link to="/forms/$formId/responses" params={{formId: r.formId}}>
              {who(r)}
            </Link>
            <span className="muted">
              {r.formTitle}
              {r.contactName && r.contactEmail ? ` · ${r.contactEmail}` : ''}
            </span>
          </span>
          <time className="muted if-rows-when" dateTime={r.submittedAt} title={when(r.submittedAt)}>
            {ago(r.submittedAt)}
          </time>
        </li>
      ))}
    </ul>
  );
}

