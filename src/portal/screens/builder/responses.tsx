import {Link, useNavigate, useParams, useSearch} from '@tanstack/react-router';
import {useCallback, useMemo} from 'react';

import type {SummaryResponse} from '../../../lib/intelform/api-responses';
import {buttonClass, EmptyState, PageHeader, Tabs} from '../../ui';
import {ResponseDrawer} from '../../intelform/responses/ResponseDrawer';
import {SummaryView} from '../../intelform/responses/SummaryView';
import {TableView} from '../../intelform/responses/TableView';
import {
  applySearchPatch,
  readResponseId,
  readSummaryState,
  readTableState,
  readView,
  summaryToTablePatch,
  type Search,
  type SearchPatch,
  type SummaryState,
  type TableState,
} from '../../intelform/responses/state';

/**
 * `/forms/$formId/responses`: Summary (default) and Table views, plus the response drawer
 * (legacy src/pages/builder/responses/ResponsesTab.tsx). All view state is in the URL
 * (?view=table&q=&filter=…&response=<id>), so every view can be linked, and charts open the
 * table filtered to what was clicked.
 */
export function ResponsesTab() {
  const {formId} = useParams({from: '/forms/$formId/responses'});
  const search = useSearch({strict: false}) as Search;
  const navigate = useNavigate();

  const view = readView(search);
  // Stable while their own keys stay the same, so opening the drawer or switching views keeps
  // the table's selection and the queries' identity.
  const tableKey = JSON.stringify(readTableState(search));
  const summaryKey = JSON.stringify(readSummaryState(search));
  const table = useMemo(() => JSON.parse(tableKey) as TableState, [tableKey]);
  const summary = useMemo(() => JSON.parse(summaryKey) as SummaryState, [summaryKey]);
  const responseId = readResponseId(search);

  /** Patch the URL: null / undefined / '' removes a key, arrays become lists. */
  const update = useCallback(
    (patch: SearchPatch, opts: {replace?: boolean} = {}) =>
      void navigate({
        to: '/forms/$formId/responses',
        params: {formId},
        search: ((prev: Search) => applySearchPatch(prev, patch)) as never,
        replace: opts.replace ?? false,
      }),
    [navigate, formId]
  );

  const openResponse = useCallback((id: string) => update({response: id}), [update]);
  const navigateResponse = useCallback((id: string) => update({response: id}, {replace: true}), [update]);
  const closeResponse = useCallback(() => update({response: null}), [update]);
  const toTable = (patch: SearchPatch, range: SummaryResponse['range']) => update(summaryToTablePatch(range, patch));

  const empty = (
    <EmptyState
      icon="inbox"
      title="No responses yet"
      action={
        <Link to="/forms/$formId/share" params={{formId}} className={buttonClass()}>
          Share your form
        </Link>
      }>
      Share your form to start collecting them.
    </EmptyState>
  );

  return (
    <div className="app-page screen-responses">
      <PageHeader title="Responses" />
      <Tabs
        label="Responses view"
        value={view}
        onChange={v => update({view: v === 'table' ? 'table' : null})}
        items={[
          {value: 'summary', label: 'Summary'},
          {value: 'table', label: 'Table'},
        ]}>
        {view === 'summary' ? (
          <SummaryView
            formId={formId}
            state={summary}
            empty={empty}
            onRange={(range, from, to) => update({range: range === '30d' ? null : range, from: from ?? null, to: to ?? null}, {replace: true})}
            onFilter={(fieldId, value, range) => toTable({filter: [`${fieldId}:${value}`]}, range)}
            onViewAll={(fieldId, range) => toTable({has: fieldId}, range)}
            onOpenResponse={openResponse}
          />
        ) : (
          <TableView formId={formId} state={table} update={update} openResponse={openResponse} activeResponseId={responseId} empty={empty} />
        )}
      </Tabs>
      <ResponseDrawer formId={formId} responseId={responseId} table={table} onNavigate={navigateResponse} onClose={closeResponse} />
    </div>
  );
}
