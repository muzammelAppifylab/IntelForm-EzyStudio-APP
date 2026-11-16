import {useMemo} from 'react';

import {FIELD_GROUP_LABEL, FIELD_GROUPS, FIELD_TYPE_META, FIELD_TYPES} from '../../../../lib/intelform/form/field-types';
import {type Command, CommandPalette} from '../../../ui';
import {fieldName} from '../ops';
import {FIELD_KEYWORDS} from '../palette-search';
import {useBuilder, useBuilderStore} from '../store';
import {FIELD_ICON} from './field-icons';

/**
 * The `/` menu: search every question type and insert it below the selected question (the kit's
 * `CommandPalette`: type to filter, ↑ ↓, Enter).
 */
export function InsertMenu({open, onOpenChange}: {open: boolean; onOpenChange(o: boolean): void}) {
  const store = useBuilderStore();
  const selection = useBuilder(s => s.selection);
  const draft = useBuilder(s => s.doc.draft);
  const selected = draft.fields.find(f => f.id === selection);
  const where = selected ? `below “${fieldName(draft, selected)}”` : selection === 'start' ? 'at the top' : 'at the end';

  const commands = useMemo<Command[]>(
    () =>
      FIELD_GROUPS.flatMap(g =>
        FIELD_TYPES.filter(t => FIELD_TYPE_META[t].group === g).map(t => ({
          id: t,
          label: FIELD_TYPE_META[t].label,
          group: FIELD_GROUP_LABEL[g],
          icon: FIELD_ICON[t],
          keywords: FIELD_KEYWORDS[t] ?? '',
          onSelect: () => store.getState().insertBelowSelection(t),
        }))
      ),
    [store]
  );

  return (
    <CommandPalette
      open={open}
      onClose={() => onOpenChange(false)}
      commands={commands}
      label="Add a question"
      placeholder={`Add a question ${where}…`}
      emptyText="No question type matches."
    />
  );
}
