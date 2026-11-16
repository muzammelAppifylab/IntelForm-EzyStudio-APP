import type {ContactFormRef} from '../../../lib/intelform/api-contacts';
import {FORM_STATUS_LABEL} from '../../../lib/intelform/api-forms';
import {IconButton, StatusBadge, type Tone, useToast} from '../../ui';
import {formatNumber} from './format';

/** Small pieces shared by the contacts table, the strip and the contact drawer. */

export const FORM_STATUS_TONES: Record<ContactFormRef['status'], Tone> = {draft: 'neutral', live: 'success', closed: 'warning'};

export function FormStatus({status}: {status: ContactFormRef['status']}) {
  return <StatusBadge tone={FORM_STATUS_TONES[status]}>{FORM_STATUS_LABEL[status]}</StatusBadge>;
}

/** Up to `limit` form titles as small chips, then "+N". */
export function FormChips({forms, total, limit = 3}: {forms: ContactFormRef[]; total: number; limit?: number}) {
  const shown = forms.slice(0, limit);
  const more = Math.max(0, total - shown.length);
  if (total === 0) return <span className="muted">–</span>;
  return (
    <ul className="contacts-chips" aria-label={`${formatNumber(total)} ${total === 1 ? 'form' : 'forms'}`}>
      {shown.map(f => (
        <li key={f.id} className="contacts-chip" title={f.title}>
          {f.title}
        </li>
      ))}
      {more > 0 && (
        <li className="contacts-chip contacts-chip-more">
          +{formatNumber(more)}
          <span className="visually-hidden"> more</span>
        </li>
      )}
    </ul>
  );
}

/** Copies a value and says so in a toast. */
export function useCopy() {
  const toast = useToast();
  return async (text: string, done: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(done);
      return true;
    } catch {
      toast.danger('Couldn’t copy. Select the text and copy it instead.');
      return false;
    }
  };
}

/** A small icon button that copies a value. */
export function CopyButton({value, label, done}: {value: string; label: string; done: string}) {
  const copy = useCopy();
  return <IconButton icon="copy" label={label} size="sm" onClick={() => void copy(value, done)} />;
}
