import {MAX_TABLE_COLUMNS, META_COLUMN_LABEL, type CatalogField, type MetaColumn, type TableColumnPref} from '../../../lib/intelform/api-responses';

/**
 * Table columns (legacy responses/columns.ts): submitted at, one per field (form order),
 * completion time, device, browser, country. Order and visibility are saved per user per form.
 */

const HIDDEN_BY_DEFAULT = new Set(['browser', 'country']);

/**
 * Columns shown before the person picks any, counting Submitted, Completion time and Device: a
 * 500-question form opens on its first questions, not 500 columns (the rest are in "Columns").
 */
export const DEFAULT_VISIBLE_COLUMNS = 30;
/** Most columns shown at once: one page sends cells for at most this many (the API's `col` limit). */
export const MAX_VISIBLE_COLUMNS = MAX_TABLE_COLUMNS;

/** Default order and visibility: questions removed from the form hidden, at most DEFAULT_VISIBLE_COLUMNS shown. */
export function defaultColumns(fields: readonly CatalogField[]): TableColumnPref[] {
  const metaShown = ['submitted_at', 'duration', 'device'].length;
  let room = DEFAULT_VISIBLE_COLUMNS - metaShown;
  const fieldCols = fields.map(f => {
    const visible = !f.deleted && room > 0;
    if (visible) room--;
    return {id: f.id, visible};
  });
  return [
    {id: 'submitted_at', visible: true},
    ...fieldCols,
    ...['duration', 'device', 'browser', 'country'].map(id => ({id, visible: !HIDDEN_BY_DEFAULT.has(id)})),
  ];
}

/** Hides the columns past the first MAX_VISIBLE_COLUMNS shown (a preference saved before the limit). */
function capVisible(columns: TableColumnPref[]): TableColumnPref[] {
  let shown = 0;
  return columns.map(c => {
    if (!c.visible) return c;
    shown++;
    return shown > MAX_VISIBLE_COLUMNS ? {...c, visible: false} : c;
  });
}

/**
 * Saved order and visibility, minus columns that no longer exist, plus new fields inserted at
 * their form position (after the nearest earlier column that is already placed).
 */
export function resolveColumns(fields: readonly CatalogField[], saved: readonly TableColumnPref[] | null): TableColumnPref[] {
  const defaults = defaultColumns(fields);
  if (!saved) return defaults;
  const known = new Set(defaults.map(c => c.id));
  const seen = new Set<string>();
  const out: TableColumnPref[] = [];
  for (const c of saved) {
    if (!known.has(c.id) || seen.has(c.id)) continue;
    seen.add(c.id);
    out.push({id: c.id, visible: c.visible});
  }
  defaults.forEach((col, i) => {
    if (seen.has(col.id)) return;
    let at = 0;
    for (let j = i - 1; j >= 0; j--) {
      const k = out.findIndex(c => c.id === defaults[j]!.id);
      if (k >= 0) {
        at = k + 1;
        break;
      }
    }
    out.splice(at, 0, col);
    seen.add(col.id);
  });
  return capVisible(out);
}

/** Moves the column at `index` one place up (-1) or down (1); out-of-range moves change nothing. */
export function moveColumn(columns: readonly TableColumnPref[], index: number, by: -1 | 1): TableColumnPref[] {
  const to = index + by;
  if (index < 0 || index >= columns.length || to < 0 || to >= columns.length) return columns.slice();
  const next = columns.slice();
  const [c] = next.splice(index, 1);
  next.splice(to, 0, c!);
  return next;
}

/** Shows or hides one column; the last visible column cannot be hidden, nor a column shown past MAX_VISIBLE_COLUMNS. */
export function toggleColumn(columns: readonly TableColumnPref[], id: string, visible: boolean): TableColumnPref[] {
  const shown = columns.filter(c => c.visible).length;
  if (!visible && shown <= 1) return columns.slice();
  if (visible && shown >= MAX_VISIBLE_COLUMNS && !columns.find(c => c.id === id)?.visible) return columns.slice();
  return columns.map(c => (c.id === id ? {...c, visible} : c));
}

export function columnLabel(id: string, fields: ReadonlyMap<string, CatalogField>): string {
  return META_COLUMN_LABEL[id as MetaColumn] ?? fields.get(id)?.label ?? id;
}
