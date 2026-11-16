import {useQuery} from '@tanstack/react-query';
import {useState} from 'react';

import {Button, Card, EmptyState} from '../../ui';
import {useCan} from '../lib/can';
import {useCreateForm} from '../queries/forms';
import {templatesQuery} from '../queries/templates';
import {suggestedTemplates, templateInput} from './format';
import {TemplateCard, TemplateGridSkeleton} from './templates';

/** First run: a short welcome, three suggested templates and "Start blank". */
export function EmptyForms() {
  const canEdit = useCan('editForms');
  const templates = useQuery({...templatesQuery, enabled: canEdit});
  const create = useCreateForm();
  const [pending, setPending] = useState<string | null>(null);

  if (!canEdit) {
    return (
      <Card>
        <EmptyState icon="form" title="No forms yet">
          Forms your team creates show up here, with their responses.
        </EmptyState>
      </Card>
    );
  }

  const suggested = suggestedTemplates(templates.data?.templates);
  const start = (id: string, template?: (typeof suggested)[number]) => {
    setPending(id);
    create.mutate(templateInput(template), {onError: () => setPending(null)});
  };

  return (
    <Card
      className="if-welcome"
      title="Make your first form"
      description="Start from one of these templates, or from a blank page. Every form works in all three layouts, so you can switch later."
      footer={
        <div className="toolbar-group">
          <Button icon="file-plus" onClick={() => start('blank')} disabled={pending !== null && pending !== 'blank'} pending={pending === 'blank'} pendingLabel="Creating…">
            Start blank
          </Button>
          {templates.isError && <span className="muted">Templates didn’t load. You can still start blank.</span>}
        </div>
      }>
      {templates.isPending ? (
        <TemplateGridSkeleton count={3} />
      ) : (
        suggested.length > 0 && (
          <div className="if-template-grid if-template-grid-3">
            {suggested.map(t => (
              <TemplateCard key={t.id} template={t} onUse={() => start(t.id, t)} busy={pending === t.id} disabled={pending !== null} />
            ))}
          </div>
        )
      )}
    </Card>
  );
}
