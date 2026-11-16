import {META_COLUMN_LABEL, type CatalogField, type MetaColumn, type TableColumnPref} from '../../../lib/intelform/api-responses';

/**
 * Table columns (legacy responses/columns.ts): submitted at, one per field (form order),
 * completion time, device, browser, country. Order and visibility are saved per user per form.
 */

const HIDDEN_BY_DEFAULT = new Set(['browser', 'country']);

export function defaultColumns(fields: readonly CatalogField[]): TableColumnPref[] {
  return ['submitted_at', ...fields.map(f => f.id), 'duration', 'device', 'browser', 'country'].map(id => ({
    id,
    visible: !HIDDEN_BY_DEFAULT.has(id),
  }));
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
  return out;
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

/** Shows or hides one column; the last visible column cannot be hidden. */
export function toggleColumn(columns: readonly TableColumnPref[], id: string, visible: boolean): TableColumnPref[] {
  if (!visible && columns.filter(c => c.visible).length <= 1) return columns.slice();
  return columns.map(c => (c.id === id ? {...c, visible} : c));
}

export function columnLabel(id: string, fields: ReadonlyMap<string, CatalogField>): string {
  return META_COLUMN_LABEL[id as MetaColumn] ?? fields.get(id)?.label ?? id;
}
