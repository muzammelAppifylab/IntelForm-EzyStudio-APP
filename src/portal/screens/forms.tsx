import {useQuery} from '@tanstack/react-query';
import {type FormEvent, useEffect, useRef, useState} from 'react';

import {FORM_SORT_LABEL, FORM_SORTS, FORM_STATUS_LABEL, FORMS_PAGE_SIZES, type FormSort, type FormStatus} from '../../lib/intelform/api-forms';
import type {FormDialog} from '../intelform/forms/bits';
import {FormsGrid, FormsSkeleton, FormsTable} from '../intelform/forms/collection';
import {FormDialogs, useDeleteFormConfirm} from '../intelform/forms/dialogs';
import {EmptyForms} from '../intelform/forms/empty';
import {formatCount, noMatchText, plural, STATUS_ORDER} from '../intelform/forms/format';
import {NewFormDrawer} from '../intelform/forms/templates';
import {WeekStrip} from '../intelform/forms/week';
import {useCan} from '../intelform/lib/can';
import {Pager, type PageTarget} from '../intelform/lib/Pager';
import {
  DEFAULT_FORMS_FILTER,
  type FormsFilter,
  formsListQuery,
  formsStripQuery,
  rememberedFormsSize,
  rememberFormsSize,
  useFormActions,
  useFormsView,
} from '../intelform/queries/forms';
import {FIRST_PAGE, type PageNav} from '../intelform/queries/responses';
import {Button, Card, EmptyState, ErrorNote, PageHeader, SearchInput, SegmentedControl, Select, ToggleGroup} from '../ui';

/**
 * `/forms`: every form. The week's numbers, then search, a status filter (with counts), sort,
 * grid or list (remembered per user), numbered pages with a per-page choice (the dashboard's pager); create blank or from a template,
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

  const [size, setSize] = useState(rememberedFormsSize);
  const [nav, setNav] = useState<PageNav>(FIRST_PAGE);
  const [via, setVia] = useState<PageTarget | null>(null);
  const topRef = useRef<HTMLDivElement>(null);
  // A new search, filter or sort is a new list: back to page 1.
  const filterSig = JSON.stringify(filter);
  const [seenSig, setSeenSig] = useState(filterSig);
  if (filterSig !== seenSig) {
    setSeenSig(filterSig);
    setNav(FIRST_PAGE);
  }

  const list = useQuery(formsListQuery(filter, size, nav));
  const strip = useQuery(formsStripQuery).data;
  const actions = useFormActions();
  const confirmDelete = useDeleteFormConfirm();

  const first = list.data;
  const forms = first?.forms;
  const noForms = first?.total === 0;
  const settled = !!first && !list.isPlaceholderData;

  // A page that came back empty or out of step (forms deleted meanwhile): back to page 1.
  useEffect(() => {
    if (!settled || !first || nav.page === 1) return;
    if (first.forms.length === 0 || (nav.before && !first.prevCursor)) setNav(FIRST_PAGE);
  }, [settled, first, nav]);

  const page = nav.page;
  const lastPage = first ? Math.max(1, Math.ceil(first.matched / size)) : 1;
  const pending = list.isPlaceholderData ? via : null;
  const go = (to: PageTarget) => {
    if (!first) return;
    let next: PageNav;
    if (to === 'first' || (to === 'prev' && (page <= 2 || !first.prevCursor))) next = FIRST_PAGE;
    else if (to === 'prev') next = {page: page - 1, before: first.prevCursor!};
    else if (to === 'next') {
      if (!first.nextCursor) return;
      next = {page: page + 1, cursor: first.nextCursor};
    } else next = lastPage === 1 ? FIRST_PAGE : {page: lastPage, last: first.matched - (lastPage - 1) * size};
    setVia(to);
    setNav(next);
    // Back to the top of the list when the pager was clicked below it.
    const top = topRef.current;
    if (top && top.getBoundingClientRect().top < 0) top.scrollIntoView({block: 'start'});
  };
  const changeSize = (n: number) => {
    setSize(n);
    setNav(FIRST_PAGE);
    rememberFormsSize(n);
  };
  const fromRow = forms?.length ? (page - 1) * size + 1 : 0;
  const toRow = (page - 1) * size + (forms?.length ?? 0);
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
            <div ref={topRef} className={list.isPlaceholderData ? 'if-forms-results if-stale' : 'if-forms-results'} aria-busy={list.isFetching || undefined}>
              {view === 'grid' ? (
                <FormsGrid forms={forms} actions={actions} onDialog={setDialog} onDelete={confirmDelete} />
              ) : (
                <FormsTable forms={forms} actions={actions} onDialog={setDialog} onDelete={confirmDelete} />
              )}
              {first && (
                <div className="list-foot">
                  <p className="muted list-count" aria-live="polite">
                    {first.matched > forms.length || page > 1 ? (
                      <>
                        Showing <strong>{formatCount(fromRow)}–{formatCount(toRow)}</strong> of{' '}
                      </>
                    ) : null}
                    {plural(first.matched, 'form')}
                    {filtered && first.matched !== first.total && ` (filtered from ${formatCount(first.total)})`}
                  </p>
                  {(first.total > FORMS_PAGE_SIZES[0] || page > 1) && (
                    <Pager
                      page={page}
                      lastPage={lastPage}
                      lastPageCapped={false}
                      hasPrev={page > 1}
                      hasNext={!!first.nextCursor}
                      size={size}
                      sizes={FORMS_PAGE_SIZES}
                      pending={pending}
                      onGo={go}
                      onSize={changeSize}
                    />
                  )}
                </div>
              )}
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
