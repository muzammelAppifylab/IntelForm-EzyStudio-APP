import {useState} from 'react';
import {DragDropProvider, DragOverlay} from '@dnd-kit/react';
import {isSortable} from '@dnd-kit/react/sortable';

import {FIELD_TYPE_META, type FieldType} from '../../../lib/intelform/form/field-types';
import {BuildToolbar} from '../../intelform/builder/build/BuildToolbar';
import {Canvas, CANVAS_END} from '../../intelform/builder/build/Canvas';
import {DeleteDialog} from '../../intelform/builder/build/DeleteDialog';
import {FIELD_ICON} from '../../intelform/builder/build/field-icons';
import {InsertMenu} from '../../intelform/builder/build/InsertMenu';
import {Palette} from '../../intelform/builder/build/Palette';
import {useBuildShortcuts} from '../../intelform/builder/lifecycle';
import {SettingsPanel} from '../../intelform/builder/panel/SettingsPanel';
import {useBuilderStore} from '../../intelform/builder/store';
import {restoreFocusIfLost} from '../../intelform/lib/focus';
import {cn} from '../../intelform/lib/utils';
import {Icon} from '../../ui';
import '../../intelform/builder/build/dnd.css';

function refocusHandle(fieldId: string) {
  restoreFocusIfLost(() => document.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(fieldId)}"] .if-drag-handle`));
}

/**
 * `/forms/$formId/build`: three panes (PRD "Build tab"): the question types (click, drag, or
 * `/` to search), the canvas (drag to reorder, or the keyboard: space picks a card's handle up,
 * arrows move, space drops; Ctrl/⌘+Shift+↑/↓; Move up/down in ⋯), and the settings panel for
 * whatever is selected. Every edit goes through the builder store and autosaves.
 */
export function BuildTab() {
  const store = useBuilderStore();
  const [insertOpen, setInsertOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(true);
  useBuildShortcuts(store, {openInsert: () => !store.getState().readOnly && setInsertOpen(true)});

  return (
    <DragDropProvider
      onDragStart={() => document.documentElement.setAttribute('data-if-dragging', '')}
      onDragEnd={event => {
        document.documentElement.removeAttribute('data-if-dragging');
        const {source, target} = event.operation;
        // Sorting moves the card's DOM node, which drops focus to <body> during a keyboard drag
        // (dropped or cancelled): give it back to the handle of the card that was moved.
        if (source && isSortable(source)) refocusHandle(String(source.id));
        if (event.canceled) return;
        const s = store.getState();
        if (!source || s.readOnly) return;
        if (source.type === 'palette') {
          const type = (source.data as {fieldType: FieldType}).fieldType;
          if (!target) return;
          const fields = s.doc.draft.fields;
          const at = target.id === CANVAS_END ? undefined : fields.findIndex(f => f.id === target.id);
          if (at === -1) return;
          // The new question's label takes focus (store.autoFocus).
          s.addField(type, at);
          return;
        }
        if (isSortable(source) && source.initialIndex !== source.index) {
          s.move(String(source.id), source.index);
        }
      }}>
      <div className={cn('screen-builder-build if-build', !paletteOpen && 'is-palette-collapsed')}>
        <Palette collapsed={!paletteOpen} onToggle={() => setPaletteOpen(o => !o)} />
        <div className="if-canvas-pane">
          <Canvas onInsert={() => setInsertOpen(true)} />
          <BuildToolbar onInsert={() => setInsertOpen(true)} />
        </div>
        <SettingsPanel />
      </div>
      <DragOverlay dropAnimation={null} disabled={source => source?.type !== 'palette'}>
        {source => {
          const type = (source.data as {fieldType?: FieldType} | undefined)?.fieldType;
          if (!type) return null;
          return (
            <div className="if-drag-chip">
              <Icon name={FIELD_ICON[type]} size={16} />
              {FIELD_TYPE_META[type].label}
            </div>
          );
        }}
      </DragOverlay>
      <InsertMenu open={insertOpen} onOpenChange={setInsertOpen} />
      <DeleteDialog />
    </DragDropProvider>
  );
}
