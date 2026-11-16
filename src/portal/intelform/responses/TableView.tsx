import {useInfiniteQuery, useQuery} from '@tanstack/react-query';
import {useEffect, useMemo, useState, type ReactNode} from 'react';

import type {CatalogField, ResponseRow} from '../../../lib/intelform/api-responses';
import {
  Button,
  buttonClass,
  Checkbox,
  DataTable,
  EmptyState,
  ErrorNote,
  Icon,
  IconButton,
  LoadMore,
  LoadingBlock,
  SearchInput,
  useToast,
  type Column,
} from '../../ui';
import {useCan} from '../lib/can';
import {errorMessage} from '../lib/api';
import {responsePrefsQuery, responsesListQuery, useSaveResponsePrefs} from '../queries/responses';
import {columnLabel, resolveColumns} from './columns';
import {useConfirmDelete} from './ConfirmDelete';
import {countryLabel, deviceLabel, formatDateTime, formatDuration, formatNumber} from './format';
import {CalendarRange} from './RangePicker';
import {CLEAR_TABLE_FILTERS, csvUrl, isTableFiltered, sortPatch, type SearchPatch, type TableState} from './state';
import {ColumnsMenu, FilterMenu} from './TableMenus';

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
 * configurable columns, selection with export / delete, keyset "Load more". Selection is kept
 * while more rows load and cleared when the filters change.
 */
export function TableView({formId, state, update, openResponse, activeResponseId, empty}: TableViewProps) {
  const list = useInfiniteQuery(responsesListQuery(formId, state));
  const prefs = useQuery(responsePrefsQuery(formId));
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
  const filterKey = JSON.stringify(state);
  const [selectionKey, setSelectionKey] = useState(filterKey);
  if (filterKey !== selectionKey) {
    setSelectionKey(filterKey);
    setSelected(new Set());
  }

  const first = list.data?.pages[0];
  const rows = useMemo(() => list.data?.pages.flatMap(p => p.rows), [list.data]);
  const fields = first?.fields;
  const fieldMap = useMemo(() => new Map((fields ?? []).map(f => [f.id, f])), [fields]);
  const columns = useMemo(() => resolveColumns(fields ?? [], prefs.data?.columns ?? null), [fields, prefs.data?.columns]);
  // "View all" (?has=) always shows that question's column.
  const visible = columns.filter(c => c.visible || c.id === state.has);

  if (list.error && !first) return <ErrorNote error={list.error} title="Responses didn’t load" />;
  if (!first || !rows) return <LoadingBlock rows={6} />;
  if (first.formTotal === 0) return <>{empty}</>;

  const filtered = isTableFiltered(state);
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

  return (
    <div className="responses-table" aria-busy={list.isPlaceholderData || undefined}>
      <div className="toolbar">
        <div className="toolbar-group">
          <SearchInput label="Search answers" placeholder="Search answers" value={search} onChange={e => setSearch(e.target.value)} />
          <CalendarRange
            label="Any date"
            from={state.from}
            to={state.to}
            active={!!state.from}
            onApply={(from, to) => update({tfrom: from, tto: to})}
            onClear={() => update({tfrom: null, tto: null})}
          />
          <FilterMenu fields={first.fields} active={state.filter} onChange={filter => update({filter})} />
        </div>
        <div className="toolbar-group">
          <ColumnsMenu
            columns={columns}
            labelOf={id => columnLabel(id, fieldMap)}
            onChange={cols => savePrefs.mutate(cols)}
            onReset={() => savePrefs.mutate(resolveColumns(first.fields, null))}
          />
          <a className={buttonClass({variant: 'secondary', size: 'sm'})} href={csvUrl(formId, state)} download>
            <Icon name="download" size={16} />
            Export CSV
          </a>
        </div>
      </div>

      <ActiveFilters state={state} fields={fieldMap} update={update} />

      {selected.size > 0 && (
        <div role="region" aria-label="Selection" className="responses-selection">
          <span className="responses-selection-count">{formatNumber(selected.size)} selected</span>
          <a className={buttonClass({variant: 'secondary', size: 'sm'})} href={csvUrl(formId, state, ids)} download>
            <Icon name="download" size={16} />
            Export selected
          </a>
          {canDelete && (
            <Button
              variant="secondary"
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

      <div className="responses-table-foot">
        <p className="muted responses-count">
          {rows.length < first.total ? `Showing ${formatNumber(rows.length)} of ` : ''}
          {formatNumber(first.total)} {first.total === 1 ? 'response' : 'responses'}
          {filtered && first.total !== first.formTotal && ` (filtered from ${formatNumber(first.formTotal)})`}
        </p>
        <LoadMore query={list} />
      </div>
    </div>
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
      <a href={url} target="_blank" rel="noreferrer" className="responses-link">
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
