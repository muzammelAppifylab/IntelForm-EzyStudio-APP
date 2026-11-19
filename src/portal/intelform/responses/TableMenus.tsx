import type {CatalogField, TableColumnPref} from '../../../lib/intelform/api-responses';
import {Button, buttonClass, Checkbox, Collapsible, Icon, IconButton, Popover, ScrollArea} from '../../ui';
import {MAX_VISIBLE_COLUMNS, moveColumn, toggleColumn} from './columns';
import {countryLabel} from './format';

/** "Filter": one section per choice question, its options as checkboxes (OR within a question, AND across). */
export function FilterMenu({fields, active, onChange}: {fields: CatalogField[]; active: string[]; onChange: (filter: string[]) => void}) {
  const choices = fields.filter(f => f.filterable && f.options?.length);
  if (!choices.length) return null;
  const toggle = (key: string, on: boolean) => onChange(on ? [...active, key] : active.filter(x => x !== key));
  return (
    <Popover
      label="Filter by answer"
      wide
      triggerClassName={buttonClass({variant: active.length ? 'primary' : 'secondary', size: 'sm'})}
      trigger={
        <>
          <Icon name="filter" size={16} />
          Filter{active.length ? ` (${active.length})` : ''}
        </>
      }>
      <div className="responses-menu">
        <div className="responses-menu-head">
          <span className="responses-menu-title">Filter by answer</span>
          {active.length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => onChange([])}>
              Clear
            </Button>
          )}
        </div>
        <ScrollArea label="Questions" size="md">
          <div className="responses-filter-list">
            {choices.map(f => {
              const n = active.filter(x => x.startsWith(`${f.id}:`)).length;
              return (
                <Collapsible key={f.id} title={f.label} description={n ? `${n} selected` : undefined} defaultOpen={n > 0}>
                  <div className="responses-filter-options">
                    {f.options!.map(o => {
                      const key = `${f.id}:${o.id}`;
                      return (
                        <Checkbox
                          key={o.id}
                          label={f.type === 'country' && o.label === o.id ? countryLabel(o.id) : o.label}
                          description={o.deleted ? 'No longer on the form' : undefined}
                          checked={active.includes(key)}
                          onChange={on => toggle(key, on)}
                        />
                      );
                    })}
                  </div>
                </Collapsible>
              );
            })}
          </div>
        </ScrollArea>
      </div>
    </Popover>
  );
}

/** Show / hide and reorder columns. Saved per user per form. */
export function ColumnsMenu({
  columns,
  labelOf,
  onChange,
  onReset,
}: {
  columns: TableColumnPref[];
  labelOf: (id: string) => string;
  onChange: (columns: TableColumnPref[]) => void;
  onReset: () => void;
}) {
  const visibleCount = columns.filter(c => c.visible).length;
  const full = visibleCount >= MAX_VISIBLE_COLUMNS;
  return (
    <Popover
      label="Table columns"
      wide
      align="end"
      triggerClassName={buttonClass({variant: 'secondary', size: 'sm'})}
      trigger={
        <>
          <Icon name="columns" size={16} />
          Columns
        </>
      }>
      <div className="responses-menu">
        <div className="responses-menu-head">
          <span className="responses-menu-title">Columns</span>
          <Button variant="ghost" size="sm" onClick={onReset}>
            Reset
          </Button>
        </div>
        <ScrollArea label="Columns" size="md">
          <ul className="responses-columns-list">
            {columns.map((c, i) => {
              const label = labelOf(c.id);
              return (
                <li key={c.id}>
                  <Checkbox
                    label={label}
                    checked={c.visible}
                    description={!c.visible && full ? `Hide a column first: at most ${MAX_VISIBLE_COLUMNS} show at once` : undefined}
                    // Keep at least one column, and at most MAX_VISIBLE_COLUMNS.
                    disabled={(c.visible && visibleCount === 1) || (!c.visible && full)}
                    onChange={on => onChange(toggleColumn(columns, c.id, on))}
                  />
                  <span className="responses-columns-moves">
                    <IconButton icon="arrow-up" size="sm" label={`Move ${label} up`} disabled={i === 0} onClick={() => onChange(moveColumn(columns, i, -1))} />
                    <IconButton
                      icon="arrow-down"
                      size="sm"
                      label={`Move ${label} down`}
                      disabled={i === columns.length - 1}
                      onClick={() => onChange(moveColumn(columns, i, 1))}
                    />
                  </span>
                </li>
              );
            })}
          </ul>
        </ScrollArea>
      </div>
    </Popover>
  );
}
