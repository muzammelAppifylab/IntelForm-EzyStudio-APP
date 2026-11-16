import {useBuilder} from '../store';
import {FieldPanel} from './FieldPanel';
import {FormPanel} from './FormPanel';
import './panel.css';

/** Right pane: the selected question, a screen, or form-level options when nothing is selected. */
export function SettingsPanel() {
  const selection = useBuilder(s => s.selection);
  const exists = useBuilder(s => !!s.selection && s.doc.draft.fields.some(f => f.id === s.selection));
  return (
    <aside aria-label="Settings" className="if-settings-panel">
      {exists && selection ? (
        <FieldPanel key={selection} id={selection} />
      ) : (
        <FormPanel focus={selection === 'start' ? 'start' : selection === 'end' ? 'end' : null} />
      )}
    </aside>
  );
}
