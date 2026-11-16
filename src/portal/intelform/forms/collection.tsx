import {Link} from '@tanstack/react-router';

import type {FormListItem} from '../../../lib/intelform/api-forms';
import {ago, when} from '../../shared';
import {Card, type Column, DataTable, Icon, Skeleton} from '../../ui';
import type {useFormActions} from '../queries/forms';
import {FormActionsMenu, FormBadges, type FormDialog, LayoutIcon} from './bits';
import {formatCount, formatRate, layoutIcon, layoutLabel} from './format';

type Props = {
  forms: FormListItem[];
  actions: ReturnType<typeof useFormActions>;
  onDialog: (d: FormDialog) => void;
  onDelete: (form: FormListItem) => void;
};

function Edited({iso}: {iso: string}) {
  return (
    <time dateTime={iso} title={when(iso)}>
      {ago(iso)}
    </time>
  );
}

/** Forms as cards: status, title (links to the builder), layout, responses, completion, last edit. */
export function FormsGrid({forms, actions, onDialog, onDelete}: Props) {
  return (
    <ul className="if-forms-grid" aria-label="Forms">
      {forms.map(form => {
        const empty = form.status === 'draft' && form.responseCount === 0;
        return (
          <li key={form.id} className="if-form-card" aria-busy={actions.busyId === form.id || undefined}>
            <div className="if-form-card-top">
              <FormBadges form={form} />
              {/* Above the title link's card-wide overlay, which comes later in the DOM. */}
              <div className="if-form-card-menu">
                <FormActionsMenu form={form} actions={actions} onDialog={onDialog} onDelete={onDelete} />
              </div>
            </div>
            <h3 className="if-form-card-title">
              {/* The title link covers the card; the menu sits above it. */}
              <Link to="/forms/$formId/build" params={{formId: form.id}}>
                {form.title}
              </Link>
            </h3>
            <p className="if-form-card-layout">
              <Icon name={layoutIcon(form.layout)} size={16} />
              <span className="visually-hidden">Layout: </span>
              {layoutLabel(form.layout)}
            </p>
            <dl className="if-form-card-stats">
              <div>
                <dt>Responses</dt>
                <dd>{empty ? '—' : formatCount(form.responseCount)}</dd>
              </div>
              <div>
                <dt>Completion</dt>
                <dd>{formatRate(form.completionRate)}</dd>
              </div>
            </dl>
            <div className="if-form-card-foot">
              <p>
                Edited <Edited iso={form.updatedAt} />
              </p>
              {form.newThisWeek > 0 && <span className="if-new-pill">+{formatCount(form.newThisWeek)} new</span>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Forms as a table (the kit's DataTable: cards on a phone). */
export function FormsTable({forms, actions, onDialog, onDelete}: Props) {
  const columns: Column<FormListItem>[] = [
    {
      key: 'form',
      header: 'Form',
      cell: form => (
        <span className="if-form-row">
          <LayoutIcon layout={form.layout} size="sm" />
          <span className="cell-title">
            <Link to="/forms/$formId/build" params={{formId: form.id}}>
              {form.title}
            </Link>
          </span>
        </span>
      ),
    },
    {key: 'status', header: 'Status', width: 'shrink', cell: form => <FormBadges form={form} />},
    {
      key: 'responses',
      header: 'Responses',
      align: 'end',
      width: 'shrink',
      cell: form => (
        <span className="if-num">
          {formatCount(form.responseCount)}
          {form.newThisWeek > 0 && <span className="if-new-pill">+{formatCount(form.newThisWeek)}</span>}
        </span>
      ),
    },
    {key: 'completion', header: 'Completion', align: 'end', width: 'shrink', hideOnMobile: true, cell: form => <span className="if-num">{formatRate(form.completionRate)}</span>},
    {key: 'updated', header: 'Updated', width: 'shrink', hideOnMobile: true, cell: form => <span className="muted"><Edited iso={form.updatedAt} /></span>},
    {
      key: 'actions',
      header: 'Actions',
      actions: true,
      cell: form => <FormActionsMenu form={form} actions={actions} onDialog={onDialog} onDelete={onDelete} />,
    },
  ];
  return (
    <Card flush>
      <DataTable caption="Forms" columns={columns} rows={forms} rowKey={f => f.id} busyKey={actions.busyId ?? null} />
    </Card>
  );
}

export function FormsSkeleton({view}: {view: 'grid' | 'list'}) {
  if (view === 'list') {
    return (
      <Card flush>
        <DataTable caption="Forms" columns={SKELETON_COLUMNS} rows={undefined} rowKey={() => 0} loading />
      </Card>
    );
  }
  return (
    <ul className="if-forms-grid" aria-hidden="true">
      {Array.from({length: 6}, (_, i) => (
        <li key={i} className="if-form-card if-form-card-skeleton">
          <Skeleton width="third" />
          <Skeleton lines={2} />
          <Skeleton width="half" />
        </li>
      ))}
    </ul>
  );
}

const SKELETON_COLUMNS: Column<never>[] = [
  {key: 'form', header: 'Form', cell: () => null},
  {key: 'status', header: 'Status', width: 'shrink', cell: () => null},
  {key: 'responses', header: 'Responses', align: 'end', width: 'shrink', cell: () => null},
  {key: 'updated', header: 'Updated', width: 'shrink', hideOnMobile: true, cell: () => null},
];
