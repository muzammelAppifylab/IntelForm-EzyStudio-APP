import {useInfiniteQuery, useQuery} from '@tanstack/react-query';
import {type FormEvent, useState} from 'react';

import {FORM_SORT_LABEL, FORM_SORTS, FORM_STATUS_LABEL, type FormSort, type FormStatus} from '../../lib/intelform/api-forms';
import type {FormDialog} from '../intelform/forms/bits';
import {FormsGrid, FormsSkeleton, FormsTable} from '../intelform/forms/collection';
import {FormDialogs, useDeleteFormConfirm} from '../intelform/forms/dialogs';
import {EmptyForms} from '../intelform/forms/empty';
import {formatCount, formsSubtitle, noMatchText, plural, STATUS_ORDER} from '../intelform/forms/format';
import {NewFormDrawer} from '../intelform/forms/templates';
import {WeekStrip} from '../intelform/forms/week';
import {useCan} from '../intelform/lib/can';
import {
  DEFAULT_FORMS_FILTER,
  type FormsFilter,
  formsListQuery,
  formsStripQuery,
  useFormActions,
  useFormsView,
} from '../intelform/queries/forms';
import {Button, Card, EmptyState, ErrorNote, LoadMore, PageHeader, SearchInput, SegmentedControl, Select, ToggleGroup} from '../ui';

/**
 * `/forms`: every form. The week's numbers, then search, a status filter (with counts), sort,
 * grid or list (remembered per user), "Load more" pages; create blank or from a template,
 * duplicate, rename, save as template, close / reopen and delete with the typed title.
 * Ported from IntelForm's FormsPage.
 */
export function Forms() {
  const canEdit = useCan('editForms');
  const [filter, setFilter] = useState<FormsFilter>(DEFAULT_FORMS_FILTER);
  const [q, setQ] = useState('');
  const [view, setView] = useFormsView();
  const [creating, setCreating] = useState(false);
  const [dialog, setDialog] = useState<FormDialog>(null);

  const list = useInfiniteQuery(formsListQuery(filter));
  const strip = useQuery(formsStripQuery).data;
  const actions = useFormActions();
  const confirmDelete = useDeleteFormConfirm();

  const first = list.data?.pages[0];
  const forms = list.data?.pages.flatMap(page => page.forms);
  const noForms = first?.total === 0;
  const filtered = filter.q !== '' || filter.status !== 'all';
  const counts = strip?.counts;

  const patch = (next: Partial<FormsFilter>) => setFilter(current => ({...current, ...next}));
  // Search on submit (and when the box is cleared), not per keystroke (ui.md "Lists").
  const search = (event: FormEvent) => {
    event.preventDefault();
    patch({q: q.trim()});
  };
  const clear = () => {
    setQ('');
    setFilter(current => ({...current, q: '', status: 'all'}));
  };

  const statusOptions = (['all', ...STATUS_ORDER] as const).map(s => ({
    value: s,
    label: (
      <>
        {s === 'all' ? 'All' : FORM_STATUS_LABEL[s]}
        {counts && <span className="if-count"> {formatCount(counts[s])}</span>}
      </>
    ),
  }));

  return (
    <div className="app-page screen-forms">
      <PageHeader
        title="Forms"
        description={formsSubtitle(counts)}
        actions={
          canEdit ? (
            <Button icon="plus" onClick={() => setCreating(true)}>
              New form
            </Button>
          ) : undefined
        }
      />

      {list.isError && !list.data ? (
        <Card>
          <EmptyState
            icon="alert"
            title="Forms didn’t load"
            action={
              <Button variant="secondary" icon="refresh" onClick={() => void list.refetch()}>
                Try again
              </Button>
            }>
            {list.error.message}
          </EmptyState>
        </Card>
      ) : noForms ? (
        <EmptyForms />
      ) : (
        <>
          <WeekStrip strip={strip} />

          <div className="toolbar">
            <form className="if-forms-search" role="search" onSubmit={search} noValidate>
              <SearchInput
                label="Search forms by title"
                placeholder="Search forms"
                value={q}
                onChange={e => {
                  setQ(e.target.value);
                  if (e.target.value === '' && filter.q !== '') patch({q: ''});
                }}
              />
            </form>
            <SegmentedControl<FormStatus | 'all'> label="Filter by status" options={statusOptions} value={filter.status} onChange={status => patch({status})} />
            <div className="toolbar-group">
              <Select
                aria-label="Sort forms"
                value={filter.sort}
                onChange={e => patch({sort: e.target.value as FormSort})}
                options={FORM_SORTS.map(s => ({value: s, label: FORM_SORT_LABEL[s]}))}
              />
              <ToggleGroup<'grid' | 'list'>
                label="View"
                iconOnly
                size="sm"
                value={view}
                onChange={setView}
                options={[
                  {value: 'grid', label: 'Grid view', icon: 'layout-grid'},
                  {value: 'list', label: 'List view', icon: 'list'},
                ]}
              />
            </div>
          </div>

          {list.isError && list.data && <ErrorNote error={list.error} />}

          {!forms ? (
            <FormsSkeleton view={view} />
          ) : forms.length === 0 ? (
            <Card>
              <EmptyState
                icon="search-x"
                title={noMatchText(filter.q, filter.status).title}
                action={
                  filtered ? (
                    <Button variant="secondary" onClick={clear}>
                      Clear filters
                    </Button>
                  ) : undefined
                }>
                {noMatchText(filter.q, filter.status).body}
              </EmptyState>
            </Card>
          ) : (
            <div className={list.isPlaceholderData ? 'if-forms-results if-stale' : 'if-forms-results'} aria-busy={list.isFetching || undefined}>
              {view === 'grid' ? (
                <FormsGrid forms={forms} actions={actions} onDialog={setDialog} onDelete={confirmDelete} />
              ) : (
                <FormsTable forms={forms} actions={actions} onDialog={setDialog} onDelete={confirmDelete} />
              )}
              {first && (
                <p className="muted if-forms-shown">
                  Showing {formatCount(forms.length)} of {plural(first.matched, 'form')}
                </p>
              )}
              <LoadMore query={list} />
            </div>
          )}
          <p className="visually-hidden" role="status">
            {first && filtered ? `${plural(first.matched, 'form')} found` : ''}
          </p>
        </>
      )}

      {canEdit && <NewFormDrawer open={creating} onClose={() => setCreating(false)} />}
      <FormDialogs dialog={dialog} onClose={() => setDialog(null)} />
    </div>
  );
}
