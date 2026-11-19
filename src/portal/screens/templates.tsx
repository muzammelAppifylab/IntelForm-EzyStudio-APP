import {useQuery} from '@tanstack/react-query';
import {type FormEvent, useId, useState} from 'react';

import {templatePatchInput, type TemplateSummary} from '../../lib/intelform/api-forms';
import {groupByCategory, templateInput} from '../intelform/forms/format';
import {TemplateCard, TemplateGridSkeleton} from '../intelform/forms/templates';
import {useCan} from '../intelform/lib/can';
import {useFormErrors} from '../intelform/lib/form-errors';
import {useCreateForm} from '../intelform/queries/forms';
import {templatesQuery, useDeleteTemplate, useRenameTemplate} from '../intelform/queries/templates';
import {Button, Card, EmptyState, Field, Icon, Menu, Modal, Notice, PageHeader, useConfirm, useToast} from '../ui';

/**
 * `/templates`: the gallery. Built-in templates (in code) and the ones the team saved, by
 * category; "Use template" creates a form and opens the builder. Saved templates can be renamed
 * or deleted (editForms). Ported from IntelForm's TemplatesPage.
 */
export function Templates() {
  const canUse = useCan('editForms');
  const templates = useQuery(templatesQuery);
  const create = useCreateForm();
  const confirm = useConfirm();
  const toast = useToast();
  const remove = useDeleteTemplate();
  const [pending, setPending] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<TemplateSummary | null>(null);

  function use(t: TemplateSummary) {
    setPending(t.id);
    create.mutate(templateInput(t), {onError: () => setPending(null)});
  }

  function askDelete(t: TemplateSummary) {
    void confirm({
      title: `Delete “${t.name}”?`,
      body: 'It’s removed for the whole team. Forms already made from it aren’t affected.',
      confirmLabel: 'Delete template',
      pendingLabel: 'Deleting…',
      action: async () => {
        await remove.mutateAsync(t.id);
        toast.success('Template deleted.');
      },
    });
  }

  const groups = templates.data ? groupByCategory(templates.data.templates, templates.data.categories) : [];
  const saved = templates.data?.templates.filter(t => !t.isBuiltin) ?? [];

  return (
    <div className="app-page screen-templates">
      <PageHeader title="Templates" />

      {templates.isPending && <TemplateGridSkeleton count={6} />}

      {templates.isError && (
        <Card>
          <EmptyState
            icon="alert"
            title="Templates didn’t load"
            action={
              <Button variant="secondary" icon="refresh" onClick={() => void templates.refetch()}>
                Try again
              </Button>
            }>
            {templates.error.message}
          </EmptyState>
        </Card>
      )}

      {groups.map(g => (
        <section key={g.category} className="if-template-group" aria-labelledby={`tpl-${slugId(g.category)}`}>
          <h3 id={`tpl-${slugId(g.category)}`} className="if-section-title">
            {g.category}
          </h3>
          <div className="if-template-grid">
            {g.items.map(t => (
              <TemplateCard
                key={t.id}
                template={t}
                onUse={canUse ? () => use(t) : undefined}
                busy={pending === t.id}
                disabled={pending !== null}
                menu={
                  !t.isBuiltin && canUse ? (
                    <Menu
                      label={`Actions for ${t.name}`}
                      items={[
                        {label: 'Rename', icon: 'pencil', onSelect: () => setRenaming(t)},
                        {label: 'Delete', icon: 'trash', danger: true, onSelect: () => askDelete(t)},
                      ]}
                    />
                  ) : undefined
                }
              />
            ))}
          </div>
        </section>
      ))}

      {templates.data && saved.length === 0 && canUse && (
        <div className="if-hint-box">
          <Icon name="template" size={20} />
          <p>Your team’s own templates appear here. On the Forms page, open a form’s menu and choose “Save as template”.</p>
        </div>
      )}

      {renaming && <RenameTemplateModal key={renaming.id} template={renaming} onClose={() => setRenaming(null)} />}
    </div>
  );
}

const slugId = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');

function RenameTemplateModal({template, onClose}: {template: TemplateSummary; onClose: () => void}) {
  const id = useId();
  const toast = useToast();
  const errors = useFormErrors();
  const rename = useRenameTemplate();
  const [values, setValues] = useState({name: template.name, description: template.description});

  function submit(e: FormEvent) {
    e.preventDefault();
    const input = errors.validate(templatePatchInput, values);
    if (!input) return;
    rename.mutate(
      {id: template.id, ...input},
      {
        onSuccess: () => {
          toast.success('Template renamed.');
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
      title="Rename template"
      description="Forms already made from it keep their own titles."
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
        <Field id={`${id}-name`} label="Name" error={errors.fields.name}>
          <input
            {...errors.control('name', `${id}-name`)}
            autoFocus
            maxLength={120}
            value={values.name}
            onChange={e => setValues(v => ({...v, name: e.target.value}))}
          />
        </Field>
        <Field id={`${id}-description`} label="Description" optional error={errors.fields.description}>
          <input
            {...errors.control('description', `${id}-description`)}
            maxLength={300}
            value={values.description}
            onChange={e => setValues(v => ({...v, description: e.target.value}))}
          />
        </Field>
      </form>
    </Modal>
  );
}
