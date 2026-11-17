import {describe, expect, it} from 'vitest';

import type {CatalogField} from '../../src/lib/intelform/api-responses';
import {columnLabel, defaultColumns, moveColumn, resolveColumns, toggleColumn} from '../../src/portal/intelform/responses/columns';
import {niceMax, tickIndexes} from '../../src/portal/intelform/responses/charts';
import {deviceLabel, formatDuration, formatPct, formatShare, plural} from '../../src/portal/intelform/responses/format';
import {
  applySearchPatch,
  browserTz,
  CLEAR_TABLE_FILTERS,
  exportQuery,
  deleteCopy,
  isTableFiltered,
  navKey,
  readResponseId,
  readSummaryState,
  readTableState,
  readView,
  sortPatch,
  summaryQueryString,
  summaryToTablePatch,
  tableQueryString,
} from '../../src/portal/intelform/responses/state';

const field = (id: string, label = id): CatalogField => ({id, type: 'short_text', label, deleted: false, filterable: false});
const tz = encodeURIComponent(browserTz);

describe('responses-ui: URL state', () => {
  it('reads defaults from an empty search', () => {
    expect(readView({})).toBe('summary');
    expect(readResponseId({})).toBeNull();
    expect(readTableState({})).toEqual({q: '', from: undefined, to: undefined, filter: [], has: undefined, sort: 'submitted_at', dir: 'desc'});
    expect(readSummaryState({})).toEqual({range: '30d', from: undefined, to: undefined});
  });

  it('reads what the router parsed: numbers, single values and arrays', () => {
    const t = readTableState({q: 123, tfrom: '2026-01-01', tto: '2026-01-31', filter: 'f_abcd:o_1', has: 'f_abcd', sort: 'f_abcd', dir: 'asc'});
    expect(t).toEqual({q: '123', from: '2026-01-01', to: '2026-01-31', filter: ['f_abcd:o_1'], has: 'f_abcd', sort: 'f_abcd', dir: 'asc'});
    expect(readTableState({filter: ['f_abcd:o_1', 'f_abcd:o_2', null]}).filter).toEqual(['f_abcd:o_1', 'f_abcd:o_2']);
    expect(readTableState({dir: 'sideways'}).dir).toBe('desc');
    expect(readView({view: 'table'})).toBe('table');
    expect(readView({view: 'other'})).toBe('summary');
    expect(readResponseId({response: 'abc'})).toBe('abc');
  });

  it('ignores an unknown summary range', () => {
    expect(readSummaryState({range: 'forever'}).range).toBe('30d');
    expect(readSummaryState({range: 'custom', from: '2026-01-01', to: '2026-02-01'})).toEqual({range: 'custom', from: '2026-01-01', to: '2026-02-01'});
  });

  it('patches the search: empties remove keys, arrays are copied', () => {
    const list = ['a'];
    const next = applySearchPatch({view: 'table', q: 'x', keep: 1}, {q: '', filter: list, has: null, response: 'r1', sort: undefined});
    expect(next).toEqual({view: 'table', keep: 1, filter: ['a'], response: 'r1'});
    expect(next.filter).not.toBe(list);
    expect(applySearchPatch({filter: ['a']}, {filter: []})).toEqual({});
  });

  it('knows when the table is filtered (the sort is not a filter)', () => {
    const base = readTableState({});
    expect(isTableFiltered(base)).toBe(false);
    expect(isTableFiltered({...base, sort: 'duration', dir: 'asc'})).toBe(false);
    expect(isTableFiltered({...base, q: 'a'})).toBe(true);
    expect(isTableFiltered({...base, filter: ['f_abcd:o_1']})).toBe(true);
    expect(isTableFiltered({...base, has: 'f_abcd'})).toBe(true);
    expect(isTableFiltered({...base, to: '2026-01-01'})).toBe(true);
    expect(applySearchPatch({q: 'a', tfrom: 'x', tto: 'y', filter: ['z'], has: 'h', view: 'table'}, CLEAR_TABLE_FILTERS)).toEqual({view: 'table'});
  });

  it('builds the API query strings with the defaults left out', () => {
    expect(tableQueryString(readTableState({}))).toBe(`?tz=${tz}`);
    const t = readTableState({q: 'hi there', filter: ['f_abcd:o_1', 'f_abcd:o_2'], sort: 'duration', dir: 'asc'});
    expect(tableQueryString(t, {cursor: 'c1', page: 2})).toBe(`?q=hi+there&tz=${tz}&filter=f_abcd%3Ao_1&filter=f_abcd%3Ao_2&sort=duration&dir=asc&cursor=c1&page=2`);
    expect(summaryQueryString({range: '7d', from: '2026-01-01', to: '2026-01-02'})).toBe(`?range=7d&tz=${tz}`);
    expect(summaryQueryString({range: 'custom', from: '2026-01-01', to: '2026-01-02'})).toBe(`?range=custom&from=2026-01-01&to=2026-01-02&tz=${tz}`);
  });

  it('exports the filters, or the selected rows only (always newest first)', () => {
    const t = readTableState({q: 'x', sort: 'device', dir: 'asc'});
    expect(exportQuery(t)).toEqual({q: 'x', tz: browserTz});
    expect(exportQuery(t, ['a', 'b'])).toEqual({tz: browserTz, ids: ['a', 'b']});
  });

  it('opens the table from the summary with the chart range and nothing else', () => {
    expect(summaryToTablePatch({from: '2026-01-01', to: '2026-01-31'}, {filter: ['f_abcd:o_1']})).toEqual({
      view: 'table',
      q: null,
      tfrom: '2026-01-01',
      tto: '2026-01-31',
      filter: ['f_abcd:o_1'],
      has: null,
      sort: null,
      dir: null,
    });
  });

  it('sorts: same column flips, a new column starts ascending, submitted resets to newest first', () => {
    const base = readTableState({});
    expect(sortPatch(base, 'submitted_at')).toEqual({dir: 'asc'});
    expect(sortPatch({...base, dir: 'asc'}, 'submitted_at')).toEqual({dir: 'desc'});
    expect(sortPatch(base, 'f_abcd')).toEqual({sort: 'f_abcd', dir: 'asc'});
    expect(sortPatch({...base, sort: 'f_abcd', dir: 'asc'}, 'submitted_at')).toEqual({sort: null, dir: null});
  });

  it('maps drawer keys and delete wording', () => {
    expect(navKey('ArrowLeft')).toBe('prev');
    expect(navKey('K')).toBe('prev');
    expect(navKey('j')).toBe('next');
    expect(navKey('ArrowRight')).toBe('next');
    expect(navKey('x')).toBeNull();
    expect(deleteCopy(1)).toMatchObject({title: 'Delete this response?', confirmLabel: 'Delete response'});
    expect(deleteCopy(3)).toMatchObject({title: 'Delete 3 responses?', confirmLabel: 'Delete 3 responses'});
  });
});

describe('responses-ui: columns', () => {
  const fields = [field('f_aaaa', 'Name'), field('f_bbbb', 'Email')];

  it('defaults: submitted, fields in order, then metadata (browser and country hidden)', () => {
    expect(defaultColumns(fields)).toEqual([
      {id: 'submitted_at', visible: true},
      {id: 'f_aaaa', visible: true},
      {id: 'f_bbbb', visible: true},
      {id: 'duration', visible: true},
      {id: 'device', visible: true},
      {id: 'browser', visible: false},
      {id: 'country', visible: false},
    ]);
    expect(resolveColumns(fields, null)).toEqual(defaultColumns(fields));
  });

  it('keeps the saved order, drops gone columns and duplicates, inserts new fields at their form position', () => {
    const saved = [
      {id: 'f_bbbb', visible: true},
      {id: 'f_gone', visible: true},
      {id: 'submitted_at', visible: false},
      {id: 'f_bbbb', visible: false},
    ];
    const withNew = [field('f_aaaa'), field('f_bbbb'), field('f_cccc')];
    const ids = resolveColumns(withNew, saved).map(c => c.id);
    // Each new column goes after the nearest earlier default that is already placed (legacy behaviour).
    expect(ids).toEqual(['f_bbbb', 'f_cccc', 'duration', 'device', 'browser', 'country', 'submitted_at', 'f_aaaa']);
    expect(resolveColumns(withNew, saved).find(c => c.id === 'submitted_at')?.visible).toBe(false);
    expect(resolveColumns(withNew, saved).find(c => c.id === 'f_bbbb')?.visible).toBe(true);
  });

  it('moves and toggles, never hiding the last visible column', () => {
    const cols = defaultColumns(fields);
    expect(moveColumn(cols, 1, -1).map(c => c.id).slice(0, 2)).toEqual(['f_aaaa', 'submitted_at']);
    expect(moveColumn(cols, 0, -1)).toEqual(cols);
    expect(moveColumn(cols, cols.length - 1, 1)).toEqual(cols);
    expect(toggleColumn(cols, 'country', true).find(c => c.id === 'country')?.visible).toBe(true);
    const single = [
      {id: 'submitted_at', visible: true},
      {id: 'device', visible: false},
    ];
    expect(toggleColumn(single, 'submitted_at', false)).toEqual(single);
  });

  it('labels columns from the metadata names, the catalog, or the id', () => {
    const map = new Map(fields.map(f => [f.id, f]));
    expect(columnLabel('submitted_at', map)).toBe('Submitted');
    expect(columnLabel('duration', map)).toBe('Completion time');
    expect(columnLabel('f_aaaa', map)).toBe('Name');
    expect(columnLabel('f_zzzz', map)).toBe('f_zzzz');
  });
});

describe('responses-ui: format and charts', () => {
  it('formats durations', () => {
    expect(formatDuration(null)).toBe('–');
    expect(formatDuration(Number.NaN)).toBe('–');
    expect(formatDuration(4_000)).toBe('4s');
    expect(formatDuration(95_000)).toBe('1m 35s');
    expect(formatDuration(3_900_000)).toBe('1h 5m');
    expect(formatDuration(3 * 86_400_000)).toBe('3d');
  });

  it('formats shares, devices and plurals', () => {
    expect(formatPct(null)).toBe('–');
    expect(formatPct(12.345, 1)).toBe('12.3%');
    expect(formatShare(50)).toBe('50%');
    expect(formatShare(33.3)).toBe('33.3%');
    expect(deviceLabel('mobile')).toBe('Mobile');
    expect(deviceLabel(null)).toBe('–');
    expect(plural(1, 'answer')).toBe('1 answer');
    expect(plural(2, 'answer')).toMatch(/^2 answers$/);
  });

  it('picks a readable y-axis top and x ticks', () => {
    expect(niceMax(0)).toBe(4);
    expect(niceMax(3)).toBe(4);
    expect(niceMax(7)).toBe(10);
    expect(niceMax(13)).toBe(20);
    expect(niceMax(42)).toBe(50);
    expect(niceMax(100)).toBe(100);
    expect(tickIndexes(0)).toEqual([]);
    expect(tickIndexes(3)).toEqual([0, 1, 2]);
    expect(tickIndexes(30)).toEqual([0, 7, 15, 22, 29]);
  });
});
