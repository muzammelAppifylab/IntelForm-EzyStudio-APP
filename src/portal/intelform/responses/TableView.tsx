import {useQuery} from '@tanstack/react-query';
import {useEffect, useMemo, useRef, useState, type ReactNode} from 'react';

import {
  MIN_SEARCH_LENGTH,
  RESPONSES_PAGE_SIZE,
  RESPONSES_PAGE_SIZES,
  type CatalogField,
  type ResponseRow,
  searchTerm,
  type ResponsesScanWindow,
} from '../../../lib/intelform/api-responses';
import {
  Button,
  Checkbox,
  DataTable,
  EmptyState,
  ErrorNote,
  Icon,
  IconButton,
  LoadingBlock,
  SearchInput,
  useToast,
  type Column,
} from '../../ui';
import {useCan} from '../lib/can';
import {errorMessage} from '../lib/api';
import {FIRST_PAGE, responseFieldsQuery, responsePrefsQuery, responsesListQuery, useSaveResponsePrefs, type PageNav} from '../queries/responses';
import {columnLabel, resolveColumns} from './columns';
import {useConfirmDelete} from './ConfirmDelete';
import {countryLabel, deviceLabel, formatDateTime, formatDuration, formatNumber} from './format';
import {CalendarRange} from './RangePicker';
import {CLEAR_TABLE_FILTERS, exportQuery, isTableFiltered, sortPatch, type SearchPatch, type TableState} from './state';
import {useExport} from '../lib/exports';
import {ColumnsMenu, FilterMenu} from './TableMenus';
import {Pager, type PageTarget} from '../lib/Pager';

const SIZE_KEY = 'intelform:responses-page-size';

/** Rows per page this person last picked, in this browser. */
function rememberedSize(): number {
  try {
    const n = Number(localStorage.getItem(SIZE_KEY));
    return (RESPONSES_PAGE_SIZES as readonly number[]).includes(n) ? n : RESPONSES_PAGE_SIZE;
  } catch {
    return RESPONSES_PAGE_SIZE;
  }
}

export interface TableViewProps {
  formId: string;
  state: TableState;
  update: (patch: SearchPatch, opts?: {replace?: boolean}) => void;
  openResponse: (id: string) => void;
  activeResponseId: string | null;
  /** Shown instead of the table when the form has no responses at all. */
  empty: ReactNode;
}

/**
 * Responses → Table (legacy TableView.tsx): search, date range, choice filters, sortable and
 * configurable columns, selection with export / delete, numbered keyset pages with a rows-per-page
 * choice. Selection is kept across pages and cleared when the filters change.
 */
export function TableView({formId, state, update, openResponse, activeResponseId, empty}: TableViewProps) {
  const [size, setSize] = useState(rememberedSize);
  const [nav, setNav] = useState<PageNav>(FIRST_PAGE);
  const [via, setVia] = useState<PageTarget | null>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const prefs = useQuery(responsePrefsQuery(formId));
  // The columns come first: they decide which answers a page sends (a wide form sends only the visible ones).
  const catalog = useQuery(responseFieldsQuery(formId));
  const fields = catalog.data;
  const fieldMap = useMemo(() => new Map((fields ?? []).map(f => [f.id, f])), [fields]);
  const columns = useMemo(() => resolveColumns(fields ?? [], prefs.data?.columns ?? null), [fields, prefs.data?.columns]);
  // "View all" (?has=) always shows that question's column.
  const visible = columns.filter(c => c.visible || c.id === state.has);
  const colKey = visible.map(c => c.id).join(',');
  // A plain array: React Query keys compare by value, and the React Compiler memoizes this.
  // No visible column (old saved prefs): ask for the submitted time, never an empty id.
  const colIds = colKey ? colKey.split(',') : ['submitted_at'];
  const ready = !!fields && !prefs.isPending;
  const list = useQuery(responsesListQuery(formId, state, size, colIds, nav, ready));
  const toast = useToast();
  const savePrefs = useSaveResponsePrefs(formId, err => toast.danger(`Columns weren’t saved. ${errorMessage(err)}`));
  const askDelete = useConfirmDelete(formId);
  const canDelete = useCan('deleteResponses');
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [search, setSearch] = useState(state.q);

  // The box follows the URL (back button, "Clear filters"); typing is debounced into the URL.
  const [syncedQ, setSyncedQ] = useState(state.q);
  if (state.q !== syncedQ) {
    setSyncedQ(state.q);
    setSearch(state.q);
  }
  useEffect(() => {
    if (search === state.q) return;
    const t = setTimeout(() => update({q: search}, {replace: true}), 300);
    return () => clearTimeout(t);
  }, [search, state.q, update]);

  // New filters or sort: a new list, so a new selection.
  // (A search too short to run changes nothing.)
  const filterKey = JSON.stringify({...state, q: searchTerm(state.q)});
  const [selectionKey, setSelectionKey] = useState(filterKey);
  if (filterKey !== selectionKey) {
    setSelectionKey(filterKey);
    setSelected(new Set());
    setNav(FIRST_PAGE);
  }

  const first = list.data;
  const rows = first?.rows;
  const settled = !!first && !list.isPlaceholderData;

  // A page that came back empty or out of step (responses deleted meanwhile): back to page 1.
  useEffect(() => {
    if (!settled || !first || nav.page === 1) return;
    if (first.rows.length === 0 || (nav.before && !first.prevCursor)) setNav(FIRST_PAGE);
  }, [settled, first, nav]);
  const exporter = useExport();

  const loadError = list.error ?? catalog.error;
  if (loadError && !first) return <ErrorNote error={loadError} title="Responses didn’t load" />;
  if (!first || !rows || !fields) return <LoadingBlock rows={6} />;
  if (first.formTotal === 0) return <>{empty}</>;

  const filtered = isTableFiltered(state);
  const trimmed = search.trim();
  const searchTooShort = trimmed.length > 0 && trimmed.length < MIN_SEARCH_LENGTH;
  const allShown = rows.length > 0 && rows.every(r => selected.has(r.id));
  const select = (ids: string[], on: boolean) =>
    setSelected(s => {
      const n = new Set(s);
      for (const id of ids) {
        if (on) n.add(id);
        else n.delete(id);
      }
      return n;
    });
  const sortBy = (id: string) => update(sortPatch(state, id));

  const tableColumns: Column<ResponseRow>[] = [
    {
      key: '__select',
      header: (
        <Checkbox
          label={<span className="visually-hidden">Select all shown</span>}
          checked={allShown}
          onChange={on => select(rows.map(r => r.id), on)}
        />
      ),
      width: 'shrink',
      cell: r => (
        <Checkbox
          label={<span className="visually-hidden">Select response from {formatDateTime(r.submittedAt)}</span>}
          checked={selected.has(r.id)}
          onChange={on => select([r.id], on)}
        />
      ),
    },
    ...visible.map(
      (c, i): Column<ResponseRow> => ({
        key: c.id,
        header: <SortHeader label={columnLabel(c.id, fieldMap)} active={state.sort === c.id} dir={state.dir} onSort={() => sortBy(c.id)} highlight={c.id === state.has} />,
        width: c.id === 'submitted_at' || c.id === 'duration' ? 'shrink' : 'auto',
        hideOnMobile: i > 2,
        cell: r =>
          i === 0 ? (
            <button
              type="button"
              className="responses-open"
              aria-current={r.id === activeResponseId || undefined}
              onClick={() => openResponse(r.id)}
              aria-label={`Open response from ${formatDateTime(r.submittedAt)}`}>
              <Cell row={r} id={c.id} field={fieldMap.get(c.id)} />
            </button>
          ) : (
            <Cell row={r} id={c.id} field={fieldMap.get(c.id)} />
          ),
      })
    ),
    {
      key: '__actions',
      header: 'Actions',
      actions: true,
      cell: r => <IconButton icon="eye" size="sm" label={`View response from ${formatDateTime(r.submittedAt)}`} onClick={() => openResponse(r.id)} />,
    },
  ];

  const ids = [...selected];

  const page = nav.page;
  const lastPage = first.totalCapped ? null : Math.max(1, Math.ceil(first.total / size));
  const pending = list.isPlaceholderData ? via : null;
  const go = (to: PageTarget) => {
    let next: PageNav;
    if (to === 'first' || (to === 'prev' && (page <= 2 || !first.prevCursor))) next = FIRST_PAGE;
    else if (to === 'prev') next = {page: page - 1, before: first.prevCursor!};
    else if (to === 'next') {
      if (!first.nextCursor) return;
      next = {page: page + 1, cursor: first.nextCursor};
    } else {
      if (lastPage === null) return;
      next = lastPage === 1 ? FIRST_PAGE : {page: lastPage, last: first.total - (lastPage - 1) * size};
    }
    setVia(to);
    setNav(next);
    // Back to the top of the table when the pager was clicked below it.
    const top = topRef.current;
    if (top && top.getBoundingClientRect().top < 0) top.scrollIntoView({block: 'start'});
  };
  const changeSize = (n: number) => {
    setSize(n);
    setNav(FIRST_PAGE);
    try {
      localStorage.setItem(SIZE_KEY, String(n));
    } catch {
      // Storage blocked: the default size next time.
    }
  };
  const fromRow = rows.length ? (page - 1) * size + 1 : 0;
  const toRow = (page - 1) * size + rows.length;

  return (
    <div className="responses-table" ref={topRef} aria-busy={list.isPlaceholderData || undefined}>
      <div className="toolbar">
        <div className="toolbar-group">
          <SearchInput
            label="Search answers"
            placeholder="Search answers"
            value={search}
            onChange={e => setSearch(e.target.value)}
            aria-describedby={searchTooShort ? 'responses-search-hint' : undefined}
          />
          <CalendarRange
            label="Any date"
            from={state.from}
            to={state.to}
            active={!!state.from}
            onApply={(from, to) => update({tfrom: from, tto: to})}
            onClear={() => update({tfrom: null, tto: null})}
          />
          <FilterMenu fields={fields} active={state.filter} onChange={filter => update({filter})} />
        </div>
        <div className="toolbar-group">
          <ColumnsMenu
            columns={columns}
            labelOf={id => columnLabel(id, fieldMap)}
            onChange={cols => savePrefs.mutate(cols)}
            onReset={() => savePrefs.mutate(resolveColumns(fields, null))}
          />
          <Button
            variant="secondary"
            size="sm"
            icon="download"
            pending={exporter.pending}
            pendingLabel="Exporting…"
            onClick={() => void exporter.run({kind: 'responses', formId, query: exportQuery(state)})}>
            Export CSV
          </Button>
        </div>
      </div>

      {searchTooShort && (
        <p id="responses-search-hint" className="muted responses-search-hint" role="status">
          Type at least {MIN_SEARCH_LENGTH} characters to search.
        </p>
      )}

      <ActiveFilters state={state} fields={fieldMap} update={update} />

      {selected.size > 0 && (
        <div role="region" aria-label="Selection" className="responses-selection">
          <span className="responses-selection-count">{formatNumber(selected.size)} selected</span>
          <Button
            variant="secondary"
            size="sm"
            icon="download"
            pending={exporter.pending}
            pendingLabel="Exporting…"
            onClick={() => void exporter.run({kind: 'responses', formId, query: exportQuery(state, ids)})}>
            Export selected
          </Button>
          {canDelete && (
            <Button
              variant="danger"
              size="sm"
              icon="trash"
              onClick={() =>
                void askDelete(ids).then(ok => {
                  if (ok) setSelected(new Set());
                })
              }>
              Delete
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
        </div>
      )}

      <DataTable
        caption="Responses"
        columns={tableColumns}
        rows={rows}
        rowKey={r => r.id}
        loading={list.isFetching && !rows.length}
        empty={
          <EmptyState
            icon="search-x"
            title="No responses match these filters"
            action={
              filtered ? (
                <Button variant="secondary" onClick={() => update(CLEAR_TABLE_FILTERS)}>
                  Clear filters
                </Button>
              ) : undefined
            }
          />
        }
      />

      <div className="list-foot">
        <p className="muted list-count" aria-live="polite">
          {first.total > rows.length || page > 1 ? (
            <>
              Showing <strong>{formatNumber(fromRow)}–{formatNumber(toRow)}</strong> of{' '}
            </>
          ) : null}
          {formatNumber(first.total)}
          {first.totalCapped ? '+' : ''} {first.total === 1 && !first.totalCapped ? 'response' : 'responses'}
          {first.window?.reason === 'search' && ` in the latest ${formatNumber(first.window.size)}`}
          {filtered && first.total !== first.formTotal && ` (filtered from ${formatNumber(first.formTotal)})`}
          {first.window && <WindowNote window={first.window} />}
        </p>
        {(first.formTotal > RESPONSES_PAGE_SIZES[0] || page > 1) && (
          <Pager
            page={page}
            lastPage={lastPage}
            lastPageCapped={first.totalCapped}
            hasPrev={page > 1}
            hasNext={!!first.nextCursor}
            size={size}
            pending={pending}
            onGo={go}
            onSize={changeSize}
          />
        )}
      </div>
    </div>
  );
}

/**
 * Why only part of a big form was searched or sorted: a has / search filter looks at the newest
 * 100,000 responses, an answer sort orders the newest 50,000 (src/server/intelform/responses/query.ts).
 */
function WindowNote({window: w}: {window: ResponsesScanWindow}) {
  const n = formatNumber(w.size);
  return (
    <span className="responses-window-note">
      {' · '}
      {w.reason === 'search'
        ? `Searches look at the latest ${n} responses. Pick dates to look further back.`
        : `Sorted within the latest ${n} responses. Sort by Submitted, Completion time, Device, Browser or Country for every response.`}
    </span>
  );
}

function SortHeader({label, active, dir, onSort, highlight}: {label: string; active: boolean; dir: 'asc' | 'desc'; onSort: () => void; highlight: boolean}) {
  return (
    <button
      type="button"
      className="responses-sort"
      data-active={active ? '' : undefined}
      data-highlight={highlight ? '' : undefined}
      aria-label={`${label}: sort${active ? (dir === 'asc' ? ', sorted ascending' : ', sorted descending') : ''}`}
      onClick={onSort}>
      <span className="responses-sort-label">{label}</span>
      <Icon name={active ? (dir === 'asc' ? 'arrow-up' : 'arrow-down') : 'arrow-up-down'} size={14} />
    </button>
  );
}

function Cell({row, id, field}: {row: ResponseRow; id: string; field?: CatalogField}) {
  switch (id) {
    case 'submitted_at':
      return <span className="responses-num">{formatDateTime(row.submittedAt)}</span>;
    case 'duration':
      return <span className="responses-num">{formatDuration(row.durationMs)}</span>;
    case 'device':
      return <>{deviceLabel(row.device)}</>;
    case 'browser':
      return <>{row.browser ?? '–'}</>;
    case 'country':
      return <>{countryLabel(row.country)}</>;
  }
  const v = row.cells[id];
  if (v === undefined) return <span className="muted">–</span>;
  // The server sends a URL only for signature images it stored; any other answer is plain text.
  const url = field?.type === 'signature' ? row.urls?.[id] : undefined;
  if (url) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className="responses-link">
        View signature
      </a>
    );
  }
  return (
    <span className="responses-cell" title={v.length > 40 ? v : undefined}>
      {v}
    </span>
  );
}

function ActiveFilters({state, fields, update}: {state: TableState; fields: Map<string, CatalogField>; update: TableViewProps['update']}) {
  const chips: {key: string; label: string; remove: () => void}[] = [];
  for (const f of state.filter) {
    const [fieldId, value = ''] = f.split(':');
    const field = fields.get(fieldId!);
    const opt = field?.options?.find(o => o.id === value)?.label ?? (field?.type === 'country' ? countryLabel(value) : value);
    chips.push({key: f, label: `${field?.label ?? 'Question'}: ${opt}`, remove: () => update({filter: state.filter.filter(x => x !== f)})});
  }
  if (state.has) {
    const field = fields.get(state.has);
    chips.push({key: 'has', label: `Answered: ${field?.label ?? 'Question'}`, remove: () => update({has: null})});
  }
  if (!chips.length) return null;
  return (
    <ul className="responses-chips" aria-label="Active filters">
      {chips.map(c => (
        <li key={c.key} className="responses-chip">
          <span className="responses-chip-label">{c.label}</span>
          <IconButton icon="x" size="sm" label={`Remove filter ${c.label}`} onClick={c.remove} />
        </li>
      ))}
      {chips.length > 1 && (
        <li>
          <Button variant="link" size="sm" onClick={() => update({filter: null, has: null})}>
            Clear all
          </Button>
        </li>
      )}
    </ul>
  );
}
