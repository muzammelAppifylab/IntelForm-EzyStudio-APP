import { META_COLUMN_LABEL, type CatalogField, type MetaColumn, type TableColumnPref } from '@shared/api-responses'

/** Table columns: submitted at, one per field (form order), completion time, device, browser, country. */

const HIDDEN_BY_DEFAULT = new Set(['browser', 'country'])

export function defaultColumns(fields: CatalogField[]): TableColumnPref[] {
  return [
    'submitted_at',
    ...fields.map((f) => f.id),
    'duration',
    'device',
    'browser',
    'country',
  ].map((id) => ({ id, visible: !HIDDEN_BY_DEFAULT.has(id) }))
}

/**
 * Saved order and visibility, minus columns that no longer exist, plus new fields inserted at
 * their form position (after the nearest earlier column that is already placed).
 */
export function resolveColumns(fields: CatalogField[], saved: TableColumnPref[] | null): TableColumnPref[] {
  const defaults = defaultColumns(fields)
  if (!saved) return defaults
  const known = new Set(defaults.map((c) => c.id))
  const out = saved.filter((c) => known.has(c.id))
  const placed = new Set(out.map((c) => c.id))
  defaults.forEach((col, i) => {
    if (placed.has(col.id)) return
    let at = 0
    for (let j = i - 1; j >= 0; j--) {
      const k = out.findIndex((c) => c.id === defaults[j].id)
      if (k >= 0) {
        at = k + 1
        break
      }
    }
    out.splice(at, 0, col)
    placed.add(col.id)
  })
  return out
}

export function columnLabel(id: string, fields: Map<string, CatalogField>): string {
  return META_COLUMN_LABEL[id as MetaColumn] ?? fields.get(id)?.label ?? id
}
