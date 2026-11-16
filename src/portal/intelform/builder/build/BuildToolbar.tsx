import {LAYOUTS, type Layout} from '../../../../lib/intelform/form/definition';
import {Button, IconButton, ToggleGroup, Tooltip} from '../../../ui';
import {useBuilder, useBuilderStore} from '../store';
import {MOD} from './FieldCard';

const SHORT_LAYOUT: Record<Layout, string> = {all_at_once: 'All at once', section_by_section: 'Sections', one_at_a_time: 'One at a time'};

/** Floating pill under the canvas: undo and redo, the layout switch and Add question. */
export function BuildToolbar({onInsert}: {onInsert(): void}) {
  const store = useBuilderStore();
  const readOnly = useBuilder(s => s.readOnly);
  const canUndo = useBuilder(s => s.past.length > 0);
  const canRedo = useBuilder(s => s.future.length > 0);
  const layout = useBuilder(s => s.doc.draft.layout);
  if (readOnly) return null;

  return (
    <div className="if-toolbar-dock">
      <div role="toolbar" aria-label="Form tools" className="if-build-toolbar">
        <Tooltip content={`Undo (${MOD}Z)`}>
          <IconButton icon="undo" size="sm" label="Undo" disabled={!canUndo} onClick={() => store.getState().undo()} />
        </Tooltip>
        <Tooltip content={`Redo (${MOD}Shift+Z)`}>
          <IconButton icon="redo" size="sm" label="Redo" disabled={!canRedo} onClick={() => store.getState().redo()} />
        </Tooltip>
        <span aria-hidden="true" className="if-toolbar-divider" />
        <span className="if-toolbar-layout">
          <ToggleGroup
            label="Layout"
            size="sm"
            value={layout}
            onChange={l => layout !== l && store.getState().commit('Change layout', d => void (d.draft.layout = l))}
            options={LAYOUTS.map(l => ({value: l, label: SHORT_LAYOUT[l]}))}
          />
        </span>
        <Button variant="secondary" size="sm" icon="plus" onClick={onInsert}>
          Add question
        </Button>
      </div>
    </div>
  );
}
