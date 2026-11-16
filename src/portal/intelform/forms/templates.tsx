import {useQuery} from '@tanstack/react-query';
import {type ReactNode, useState} from 'react';

import type {TemplateSummary} from '../../../lib/intelform/api-forms';
import {Button, Drawer, Icon, Notice, Skeleton, Spinner} from '../../ui';
import {errorMessage} from '../lib/api';
import {useCreateForm} from '../queries/forms';
import {templatesQuery} from '../queries/templates';
import {LayoutIcon} from './bits';
import {groupByCategory, layoutLabel, plural, templateInput} from './format';

/** One template as a card: its layout, name, size and description; "Use template" and a menu. */
export function TemplateCard({
  template,
  onUse,
  busy,
  disabled,
  menu,
}: {
  template: TemplateSummary;
  onUse?: () => void;
  busy?: boolean;
  disabled?: boolean;
  menu?: ReactNode;
}) {
  return (
    <article className="if-template-card">
      <div className="if-template-card-head">
        <LayoutIcon layout={template.layout} />
        <div className="if-template-card-text">
          <h4>{template.name}</h4>
          <p>
            {plural(template.fieldCount, 'question')} · {layoutLabel(template.layout)}
          </p>
        </div>
        {menu}
      </div>
      {template.description && <p className="if-template-card-description">{template.description}</p>}
      {!template.isBuiltin && template.createdBy && <p className="if-template-card-meta">Saved by {template.createdBy}</p>}
      {onUse && (
        <div className="if-template-card-foot">
          <Button
            variant="secondary"
            size="sm"
            onClick={onUse}
            disabled={disabled}
            pending={busy}
            pendingLabel="Creating…"
            aria-label={`Use template: ${template.name}`}>
            Use template
          </Button>
        </div>
      )}
    </article>
  );
}

export function TemplateGridSkeleton({count = 4}: {count?: number}) {
  return (
    <div className="if-template-grid" aria-hidden="true">
      {Array.from({length: count}, (_, i) => (
        <div key={i} className="if-template-card if-template-card-skeleton">
          <Skeleton lines={3} />
        </div>
      ))}
    </div>
  );
}

/** "Start blank", then every template by category. Used by the New form drawer. */
export function TemplatePicker({
  onBlank,
  onTemplate,
  pendingId,
}: {
  onBlank: () => void;
  onTemplate: (t: TemplateSummary) => void;
  /** 'blank' or a template id while that one is being created. */
  pendingId: string | null;
}) {
  const templates = useQuery(templatesQuery);
  const busy = pendingId !== null;

  return (
    <div className="if-template-picker">
      <button type="button" className="if-start-blank" onClick={onBlank} disabled={busy}>
        <span className="if-start-blank-icon">{pendingId === 'blank' ? <Spinner size="sm" /> : <Icon name="file-plus" size={20} />}</span>
        <span className="if-start-blank-text">
          <strong>{pendingId === 'blank' ? 'Creating…' : 'Start blank'}</strong>
          <span>An empty form with the default theme</span>
        </span>
      </button>

      {templates.isPending && <TemplateGridSkeleton />}
      {templates.isError && (
        <Notice tone="danger">
          Templates didn’t load. {errorMessage(templates.error)}{' '}
          <Button variant="link" onClick={() => void templates.refetch()}>
            Try again
          </Button>
        </Notice>
      )}
      {templates.data &&
        groupByCategory(templates.data.templates, templates.data.categories).map(g => (
          <section key={g.category} className="if-template-group" aria-label={g.category}>
            <h3 className="if-overline">{g.category}</h3>
            <div className="if-template-grid">
              {g.items.map(t => (
                <TemplateCard key={t.id} template={t} onUse={() => onTemplate(t)} busy={pendingId === t.id} disabled={busy} />
              ))}
            </div>
          </section>
        ))}
    </div>
  );
}

/** "New form": start blank or from a template, then straight into the builder. */
export function NewFormDrawer({open, onClose}: {open: boolean; onClose: () => void}) {
  const create = useCreateForm();
  const [pending, setPending] = useState<string | null>(null);

  function start(id: string, template?: TemplateSummary) {
    setPending(id);
    create.mutate(templateInput(template), {onError: () => setPending(null)});
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      dismissible={!create.isPending}
      title="New form"
      description="Start from scratch or from a template. You can change everything afterwards.">
      {open && <TemplatePicker pendingId={pending} onBlank={() => start('blank')} onTemplate={t => start(t.id, t)} />}
    </Drawer>
  );
}
