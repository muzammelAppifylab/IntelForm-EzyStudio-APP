import {type FormEvent, useId, useRef, useState} from 'react';

import {renameFormInput, saveAsTemplateInput, type FormListItem} from '../../../lib/intelform/api-forms';
import {Button, Field, Modal, Notice, useConfirm, useToast} from '../../ui';
import {useFormErrors} from '../lib/form-errors';
import {useDeleteForm, useRenameForm, useSaveAsTemplate} from '../queries/forms';
import type {FormDialog} from './bits';
import {deleteMatches, formatCount} from './format';

/** Rename and Save as template, for whichever form the menu picked. */
export function FormDialogs({dialog, onClose}: {dialog: FormDialog; onClose: () => void}) {
  if (!dialog) return null;
  if (dialog.kind === 'rename') return <RenameModal key={dialog.form.id} form={dialog.form} onClose={onClose} />;
  return <SaveTemplateModal key={dialog.form.id} form={dialog.form} onClose={onClose} />;
}

function RenameModal({form, onClose}: {form: FormListItem; onClose: () => void}) {
  const id = useId();
  const toast = useToast();
  const errors = useFormErrors();
  const [title, setTitle] = useState(form.title);
  const rename = useRenameForm();

  function submit(e: FormEvent) {
    e.preventDefault();
    const input = errors.validate(renameFormInput, {title});
    if (!input) return;
    rename.mutate(
      {id: form.id, title: input.title},
      {
        onSuccess: () => {
          toast.success('Form renamed.');
          onClose();
        },
        onError: errors.fromError,
      }
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      dismissible={!rename.isPending}
      title="Rename form"
      description="The title shows in the dashboard and at the top of the public form."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={rename.isPending}>
            Cancel
          </Button>
          <Button type="submit" form={`${id}-form`} pending={rename.isPending} pendingLabel="Saving…">
            Rename
          </Button>
        </>
      }>
      <form id={`${id}-form`} className="form-stack" onSubmit={submit} noValidate>
        {errors.form && <Notice tone="danger">{errors.form}</Notice>}
        <Field id={`${id}-title`} label="Title" error={errors.fields.title}>
          <input
            id={`${id}-title`}
            autoFocus
            maxLength={200}
            value={title}
            onChange={e => setTitle(e.target.value)}
            aria-invalid={errors.fields.title ? true : undefined}
            aria-describedby={errors.fields.title ? `${id}-title-error` : undefined}
          />
        </Field>
      </form>
    </Modal>
  );
}

function SaveTemplateModal({form, onClose}: {form: FormListItem; onClose: () => void}) {
  const id = useId();
  const toast = useToast();
  const errors = useFormErrors();
  const [values, setValues] = useState({name: form.title, description: ''});
  const save = useSaveAsTemplate();

  function submit(e: FormEvent) {
    e.preventDefault();
    const input = errors.validate(saveAsTemplateInput, values);
    if (!input) return;
    save.mutate(
      {id: form.id, ...input},
      {
        onSuccess: () => {
          toast.success('Saved as template.');
          onClose();
        },
        onError: errors.fromError,
      }
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      dismissible={!save.isPending}
      title="Save as template"
      description="Your whole team can start new forms from it. Questions, design and settings are copied; responses, the password and webhook are not."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button type="submit" form={`${id}-form`} pending={save.isPending} pendingLabel="Saving…">
            Save template
          </Button>
        </>
      }>
      <form id={`${id}-form`} className="form-stack" onSubmit={submit} noValidate>
        {errors.form && <Notice tone="danger">{errors.form}</Notice>}
        <Field id={`${id}-name`} label="Template name" error={errors.fields.name}>
          <input
            id={`${id}-name`}
            autoFocus
            maxLength={120}
            value={values.name}
            onChange={e => setValues(v => ({...v, name: e.target.value}))}
            aria-invalid={errors.fields.name ? true : undefined}
          />
        </Field>
        <Field id={`${id}-description`} label="Description" optional hint="Shown on the template card." error={errors.fields.description}>
          <input
            id={`${id}-description`}
            maxLength={300}
            value={values.description}
            onChange={e => setValues(v => ({...v, description: e.target.value}))}
            aria-invalid={errors.fields.description ? true : undefined}
            aria-describedby={`${id}-description-hint`}
          />
        </Field>
      </form>
    </Modal>
  );
}

/** The typed title, kept outside React state so the confirm dialog's action reads the latest. */
function TypedConfirm({title, onType}: {title: string; onType: (value: string) => void}) {
  const id = useId();
  return (
    <span className="if-typed-confirm">
      <label htmlFor={id}>Type “{title}” to confirm</label>
      <input id={id} autoFocus autoComplete="off" spellCheck={false} onChange={e => onType(e.target.value)} />
    </span>
  );
}

/**
 * Delete a form with a typed confirmation (the form's title), through the kit's `useConfirm`:
 * the dialog stays open while it runs and shows a wrong title or a failure in words.
 */
export function useDeleteFormConfirm() {
  const confirm = useConfirm();
  const toast = useToast();
  const remove = useDeleteForm();
  const typed = useRef('');

  return (form: FormListItem) => {
    typed.current = '';
    const responses =
      form.responseCount > 0
        ? `Its ${formatCount(form.responseCount)} ${form.responseCount === 1 ? 'response is' : 'responses are'} deleted too. Export them first if you need them.`
        : 'Any responses are deleted too.';
    void confirm({
      title: `Delete “${form.title}”?`,
      body: (
        <>
          This removes the form, every published version and its public link. {responses} You can’t undo this.
          <TypedConfirm title={form.title} onType={v => (typed.current = v)} />
        </>
      ),
      confirmLabel: 'Delete form',
      pendingLabel: 'Deleting…',
      action: async () => {
        if (!deleteMatches(typed.current, form.title)) throw new Error(`Type “${form.title}” exactly as shown to delete it.`);
        await remove.mutateAsync({id: form.id, confirmTitle: typed.current});
        toast.success('Form deleted.');
      },
    });
  };
}
