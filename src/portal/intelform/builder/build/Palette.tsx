import {useState} from 'react';
import {useDraggable} from '@dnd-kit/react';

import {FIELD_GROUP_LABEL, FIELD_GROUPS, FIELD_TYPE_META, FIELD_TYPES, type FieldType} from '../../../../lib/intelform/form/field-types';
import {Icon, IconButton} from '../../../ui';
import {cn} from '../../lib/utils';
import {matchesType} from '../palette-search';
import {useBuilder, useBuilderStore} from '../store';
import {fieldTint} from '../type-ui';
import {FIELD_ICON} from './field-icons';

/** The palette's groups after a search: groups with no match are left out. Exported for tests. */
export function paletteGroups(query: string) {
  return FIELD_GROUPS.map(g => ({g, types: FIELD_TYPES.filter(t => FIELD_TYPE_META[t].group === g && matchesType(t, query))})).filter(
    x => x.types.length
  );
}

/**
 * Left card: "Add a field" with search and the field types as two-column chips by group. Click
 * (or Enter) appends; drag places it on the canvas. Collapses to an icon rail.
 */
export function Palette({collapsed, onToggle}: {collapsed: boolean; onToggle(): void}) {
  const [query, setQuery] = useState('');
  const readOnly = useBuilder(s => s.readOnly);
  const groups = paletteGroups(collapsed ? '' : query);

  return (
    <aside aria-label="Question types" className={cn('if-pane if-palette', collapsed && 'is-collapsed')}>
      <div className="if-palette-head">
        {!collapsed && <h2 className="if-pane-title">Add a field</h2>}
        <IconButton
          icon={collapsed ? 'chevron-right' : 'chevron-left'}
          size="sm"
          label={collapsed ? 'Expand field list' : 'Collapse field list'}
          aria-expanded={!collapsed}
          onClick={onToggle}
        />
      </div>
      {!collapsed && (
        <div className="if-palette-search">
          <span className="search-input">
            <Icon name="search" size={16} />
            <input type="search" aria-label="Search question types" placeholder="Search fields" value={query} onChange={e => setQuery(e.target.value)} />
          </span>
        </div>
      )}
      <div className="if-palette-body">
        {groups.length === 0 && <p className="if-caption">No question type matches “{query}”.</p>}
        {groups.map(({g, types}) => (
          <section key={g} className="if-palette-group">
            <h3 className={cn('if-overline', collapsed && 'visually-hidden')}>{FIELD_GROUP_LABEL[g]}</h3>
            <ul className="if-palette-list">
              {types.map(t => (
                <li key={t}>
                  <PaletteItem type={t} disabled={readOnly} compact={collapsed} />
                </li>
              ))}
            </ul>
          </section>
        ))}
        {!readOnly && !collapsed && <p className="if-caption">Tip: press / on the canvas to add a question below the selected one.</p>}
      </div>
    </aside>
  );
}

function PaletteItem({type, disabled, compact}: {type: FieldType; disabled: boolean; compact: boolean}) {
  const store = useBuilderStore();
  const {ref, isDragSource} = useDraggable({id: `palette:${type}`, type: 'palette', data: {fieldType: type}, disabled});
  const label = FIELD_TYPE_META[type].label;
  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled}
      aria-label={`Add ${label}`}
      title={compact ? label : undefined}
      onClick={() => {
        store.getState().addField(type);
        requestAnimationFrame(() => {
          const el = document.querySelector<HTMLElement>(`[data-card-id="${store.getState().selection}"]`);
          el?.scrollIntoView({block: 'nearest', behavior: 'smooth'});
        });
      }}
      className={cn('if-palette-item', compact && 'is-compact', isDragSource && 'is-dragging')}>
      <span className={cn('if-type-tile is-small', fieldTint(type))}>
        <Icon name={FIELD_ICON[type]} size={14} />
      </span>
      {!compact && <span className="if-truncate">{label}</span>}
    </button>
  );
}
