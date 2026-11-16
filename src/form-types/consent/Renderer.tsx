import type {FieldRendererProps} from '../../respondent/types';
import {Group} from '../../respondent/ui';
import {FtIcon} from '../_respondent/icons';

/** One checkbox with the consent text and an optional link. The browser sends {accepted, at}. */
export default function ConsentRenderer(p: FieldRendererProps<'consent'>) {
  const {field, value, onChange} = p;
  const checked = !!value && typeof value === 'object' && (value as {accepted?: unknown}).accepted === true;
  const {text, link} = field.props;
  return (
    <Group legend={p.legend} description={p.description} error={p.error} required={field.required} legendClassName={p.large ? 'rf-question-xl' : undefined}>
      <label data-state={checked ? 'checked' : 'unchecked'} className="ft-tile ft-tile-consent">
        <input
          id={p.inputId}
          type="checkbox"
          checked={checked}
          aria-invalid={p.invalid || undefined}
          aria-required={field.required || undefined}
          onChange={e => onChange(e.target.checked ? {accepted: true, at: new Date().toISOString()} : undefined)}
          className="ft-sr-only"
        />
        <span aria-hidden className="ft-checkmark">
          {checked && <FtIcon name="check" />}
        </span>
        <span className="ft-tile-label">{text}</span>
      </label>
      {link && (
        <a href={link.url} target="_blank" rel="noopener noreferrer" className="ft-consent-link">
          {link.label}
          <FtIcon name="external-link" className="ft-icon-sm" />
          <span className="ft-sr-only"> (opens in a new tab)</span>
        </a>
      )}
    </Group>
  );
}
