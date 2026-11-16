import {useNavigate} from '@tanstack/react-router';

import {FORM_STATUS_LABEL, type FormListItem, type FormStatus} from '../../../lib/intelform/api-forms';
import {Badge, Icon, Menu, type MenuItem, StatusBadge} from '../../ui';
import {useAbilities} from '../lib/can';
import {useFormActions} from '../queries/forms';
import {layoutIcon, layoutLabel, STATUS_TONES} from './format';

/** Layout mode as an icon tile with an accessible name. */
export function LayoutIcon({layout, size = 'md'}: {layout: string; size?: 'sm' | 'md'}) {
  const label = layoutLabel(layout);
  return (
    <span className={`if-layout-icon if-layout-icon-${size}`} title={`Layout: ${label}`}>
      <Icon name={layoutIcon(layout)} size={16} />
      <span className="visually-hidden">Layout: {label}</span>
    </span>
  );
}

export function FormStatusBadge({status}: {status: FormStatus}) {
  return <StatusBadge tone={STATUS_TONES[status]}>{FORM_STATUS_LABEL[status]}</StatusBadge>;
}

/** Status, and "Unpublished changes" when the draft moved on since the last Publish. */
export function FormBadges({form}: {form: Pick<FormListItem, 'status' | 'hasUnpublished'>}) {
  return (
    <span className="badges">
      <FormStatusBadge status={form.status} />
      {form.hasUnpublished && <Badge tone="info">Unpublished changes</Badge>}
    </span>
  );
}

export type FormDialog =
  | {kind: 'rename'; form: FormListItem}
  | {kind: 'template'; form: FormListItem}
  | null;

/**
 * The ⋯ menu of a form: open, responses, copy link, and for editors duplicate, rename, save as
 * template, close / reopen and (with delete rights) delete. Only shows what the viewer may do;
 * every route checks again.
 */
export function FormActionsMenu({
  form,
  actions,
  onDialog,
  onDelete,
}: {
  form: FormListItem;
  actions: ReturnType<typeof useFormActions>;
  onDialog: (d: FormDialog) => void;
  onDelete: (form: FormListItem) => void;
}) {
  const navigate = useNavigate();
  const {editForms, deleteForms, viewResponses} = useAbilities();
  const items: MenuItem[] = [
    {
      label: editForms ? 'Open builder' : 'Open form',
      icon: 'pen-line',
      onSelect: () => void navigate({to: '/forms/$formId/build', params: {formId: form.id}}),
    },
  ];
  if (viewResponses) {
    items.push({
      label: 'View responses',
      icon: 'bar-chart',
      onSelect: () => void navigate({to: '/forms/$formId/responses', params: {formId: form.id}}),
    });
  }
  items.push({label: 'Copy link', icon: 'link', onSelect: () => void actions.copyLink(form)});
  if (editForms) {
    items.push(
      'separator',
      {label: 'Duplicate', icon: 'copy-plus', onSelect: () => actions.duplicate.mutate(form)},
      {label: 'Rename', icon: 'pencil', onSelect: () => onDialog({kind: 'rename', form})},
      {label: 'Save as template', icon: 'save', onSelect: () => onDialog({kind: 'template', form})}
    );
    if (form.status === 'live') items.push({label: 'Close form', icon: 'lock', onSelect: () => actions.close.mutate(form)});
    if (form.status === 'closed') items.push({label: 'Reopen form', icon: 'lock-open', onSelect: () => actions.reopen.mutate(form)});
  }
  if (deleteForms) items.push('separator', {label: 'Delete', icon: 'trash', danger: true, onSelect: () => onDelete(form)});
  return <Menu label={`Actions for ${form.title}`} items={items} disabled={actions.busyId === form.id} />;
}
