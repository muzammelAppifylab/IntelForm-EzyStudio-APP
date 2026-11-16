import {type FormDefinition} from '../../../../lib/intelform/form/definition';
import {dependentsOf} from '../../../../lib/intelform/form/logic';
import {Button, Modal} from '../../../ui';
import {describeRule} from '../describe';
import {fieldName} from '../ops';
import {useBuilder, useBuilderStore} from '../store';

/** What depends on a question, in words: where (a question or screen) and what it does. Exported for tests. */
export function describeDependents(draft: FormDefinition, fieldId: string): {where: string; what: string}[] {
  const field = draft.fields.find(f => f.id === fieldId);
  const name = field ? fieldName(draft, field) : '';
  return dependentsOf(draft, fieldId).map(d => {
    if (d.fieldId === 'startScreen') return {where: 'Start screen', what: `Shows the answer to ${name}`};
    if (d.fieldId === 'endScreen') return {where: 'End screen', what: `Shows the answer to ${name}`};
    const f = draft.fields.find(x => x.id === d.fieldId);
    if (!f) return {where: 'A question', what: ''};
    return {where: fieldName(draft, f), what: d.via === 'logic' && f.logic ? describeRule(draft, f.logic) : `Shows the answer to ${name}`};
  });
}

/** PRD: deleting a field that rules depend on warns first and lists those rules. */
export function DeleteDialog() {
  const store = useBuilderStore();
  const pending = useBuilder(s => s.pendingDelete);
  const draft = useBuilder(s => s.doc.draft);
  const field = draft.fields.find(f => f.id === pending);
  const deps = pending && field ? describeDependents(draft, pending) : [];
  const name = field ? fieldName(draft, field) : '';
  const cancel = () => store.getState().cancelDelete();

  return (
    <Modal
      open={!!field}
      onClose={cancel}
      title={`Delete “${name}”?`}
      description="Other parts of the form use this question. Deleting it removes those conditions and answer chips. You can undo this."
      footer={
        <>
          <Button variant="secondary" onClick={cancel}>
            Keep it
          </Button>
          <Button variant="danger" onClick={() => pending && store.getState().remove(pending)}>
            Delete question
          </Button>
        </>
      }>
      <ul className="if-dependents" aria-label="Depends on this question">
        {deps.map((d, i) => (
          <li key={i} className="if-dependent">
            <span className="if-label">{d.where}</span>
            <span className="if-caption">{d.what}</span>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
