import {type ReactNode, useRef} from 'react';

import {type FormField, newOptionId} from '../../../../lib/intelform/form/definition';
import {ADDRESS_LINES, countryName} from '../../../../lib/intelform/form/types/registry';
import {Icon, type IconName} from '../../../ui';
import {cn} from '../../lib/utils';
import {useBuilderStore} from '../store';

const FACES: IconName[] = ['angry', 'frown', 'meh', 'smile', 'laugh'];

/** A quiet, non-interactive look at the answer area, so the canvas reads like the form. */
function Box({children, className, tall}: {children?: ReactNode; className?: string; tall?: boolean}) {
  return <div className={cn('if-prev-box', tall && 'is-tall', className)}>{children}</div>;
}

const ADDRESS_LABEL: Record<string, string> = {
  street: 'Street address',
  line2: 'Address line 2',
  city: 'City',
  state: 'State / province',
  postal: 'Postal code',
  country: 'Country',
};

const TEXT_PLACEHOLDER = {email: 'name@example.com', phone: '+1 555 000 0000', url: 'https://', number: '0'} as const;

export function FieldPreview({field, editable}: {field: FormField; editable: boolean}) {
  const placeholder = field.placeholder || 'Type your answer here';
  switch (field.type) {
    case 'section_break':
      return null;
    case 'short_text':
    case 'email':
    case 'phone':
    case 'url':
    case 'number':
      return (
        <Box>
          <span className="if-truncate">
            {field.type === 'number' && field.props.prefix}
            {field.placeholder || (field.type === 'short_text' ? placeholder : TEXT_PLACEHOLDER[field.type])}
            {field.type === 'number' && field.props.suffix}
          </span>
        </Box>
      );
    case 'long_text':
      return <Box tall>{placeholder}</Box>;
    case 'name':
      return field.props.split ? (
        <div className="if-prev-grid2">
          <Box>First name</Box>
          <Box>Last name</Box>
        </div>
      ) : (
        <Box>{field.placeholder || 'Full name'}</Box>
      );
    case 'address':
      return (
        <div className="if-prev-grid2">
          {ADDRESS_LINES.filter(l => field.props.lines[l]).map(l => (
            <Box key={l} className={l === 'street' || l === 'line2' ? 'is-full' : undefined}>
              {ADDRESS_LABEL[l]}
            </Box>
          ))}
        </div>
      );
    case 'country':
    case 'dropdown':
      return (
        <Box>
          <span className="if-truncate">
            {field.type === 'country' && field.props.defaultCountry
              ? countryName(field.props.defaultCountry)
              : field.placeholder || 'Choose an option'}
          </span>
          <Icon name="chevron-down" size={16} />
        </Box>
      );
    case 'date':
      return (
        <Box className="if-prev-date">
          {field.props.format}
          <Icon name="calendar" size={16} />
        </Box>
      );
    case 'time':
      return (
        <Box className="if-prev-time">
          {field.props.hourCycle === '12' ? 'hh:mm AM' : 'HH:mm'}
          <Icon name="clock" size={16} />
        </Box>
      );
    case 'single_choice':
    case 'multiple_choice':
      return <OptionsPreview field={field} editable={editable} />;
    case 'yes_no':
      return (
        <div className="if-row">
          {[field.props.yesLabel, field.props.noLabel].map((l, i) => (
            <span key={i} className="if-prev-chip">
              {l}
            </span>
          ))}
        </div>
      );
    case 'picture_choice':
      return (
        <div className={cn('if-prev-pictures', `if-cols-${field.props.columns}`)}>
          {field.props.options.slice(0, 8).map((o, i) => (
            <div key={o.id} className="if-prev-picture">
              <div className="if-prev-picture-img">{o.imageUrl ? <img src={o.imageUrl} alt="" /> : <Icon name="image" size={20} />}</div>
              <p className="if-truncate">{o.label || `Option ${i + 1}`}</p>
            </div>
          ))}
        </div>
      );
    case 'rating':
      return (
        <div className="if-prev-scale">
          <div className="if-prev-scale-row" aria-hidden="true">
            {Array.from({length: field.props.scale}, (_, i) =>
              field.props.style === 'stars' ? (
                <span key={i} className="if-prev-star">
                  <Icon name="star" size={24} />
                </span>
              ) : (
                <span key={i} className="if-prev-step">
                  {field.props.style === 'numbers' ? i + 1 : <Icon name={FACES[Math.round((i / Math.max(1, field.props.scale - 1)) * 4)]!} size={16} />}
                </span>
              )
            )}
          </div>
          {(field.props.leftLabel || field.props.rightLabel) && (
            <div className="if-prev-scale-labels">
              <span>{field.props.leftLabel}</span>
              <span>{field.props.rightLabel}</span>
            </div>
          )}
        </div>
      );
    case 'nps':
      return (
        <div className="if-prev-nps">
          <div className="if-prev-nps-row" aria-hidden="true">
            {Array.from({length: 11}, (_, i) => (
              <span key={i} className="if-prev-step">
                {i}
              </span>
            ))}
          </div>
          <div className="if-prev-scale-labels">
            <span>{field.props.lowLabel}</span>
            <span>{field.props.highLabel}</span>
          </div>
        </div>
      );
    case 'signature':
      return (
        <Box tall className="if-prev-signature">
          Sign here
        </Box>
      );
    case 'consent':
      return (
        <div className="if-prev-consent">
          <span className="if-prev-check" aria-hidden="true" />
          <span>
            {field.props.text}
            {field.props.link && <span className="if-prev-link">{field.props.link.label}</span>}
          </span>
        </div>
      );
  }
}

type ChoiceField = Extract<FormField, {type: 'single_choice' | 'multiple_choice'}>;

/** Options for single and multiple choice; option labels are edited right here when selected. */
function OptionsPreview({field, editable}: {field: ChoiceField; editable: boolean}) {
  const store = useBuilderStore();
  const list = useRef<HTMLUListElement>(null);
  const marker = <span className={cn('if-prev-marker', field.type === 'single_choice' && 'is-round')} aria-hidden="true" />;

  const update = (recipe: (opts: {id: string; label: string}[]) => void, key?: string, label = 'Edit options') =>
    store.getState().updateField(field.id, f => recipe((f.props as {options: {id: string; label: string}[]}).options), key, label);

  const focusOption = (i: number) => requestAnimationFrame(() => list.current?.querySelectorAll<HTMLInputElement>('input')[i]?.focus());

  return (
    <ul ref={list} className={cn('if-prev-options', field.props.orientation === 'horizontal' && 'is-horizontal')} aria-label="Options">
      {field.props.options.map((o, i) => (
        <li key={o.id} className="if-prev-option">
          {marker}
          {editable ? (
            <>
              <input
                aria-label={`Option ${i + 1}`}
                value={o.label}
                placeholder={`Option ${i + 1}`}
                maxLength={500}
                className="if-prev-option-input"
                onChange={e => update(opts => void (opts[i]!.label = e.target.value), `option:${o.id}`)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    if (field.props.options.length >= 200) return;
                    update(opts => void opts.splice(i + 1, 0, {id: newOptionId(), label: ''}), undefined, 'Add option');
                    focusOption(i + 1);
                  }
                  if (e.key === 'Backspace' && o.label === '' && field.props.options.length > 1) {
                    e.preventDefault();
                    update(opts => void opts.splice(i, 1), undefined, 'Delete option');
                    focusOption(Math.max(0, i - 1));
                  }
                }}
              />
              {field.props.options.length > 1 && (
                <button
                  type="button"
                  aria-label={`Delete option ${o.label || i + 1}`}
                  className="if-prev-option-delete"
                  onClick={() => update(opts => void opts.splice(i, 1), undefined, 'Delete option')}>
                  <Icon name="x" size={14} />
                </button>
              )}
            </>
          ) : (
            <span>{o.label || `Option ${i + 1}`}</span>
          )}
        </li>
      ))}
      {field.props.other && (
        <li className="if-prev-option is-other">
          {marker}
          Other
        </li>
      )}
      {editable && field.props.options.length < 200 && (
        <li>
          <button
            type="button"
            className="if-link-button if-add-option"
            onClick={() => {
              update(opts => void opts.push({id: newOptionId(), label: ''}), undefined, 'Add option');
              focusOption(field.props.options.length);
            }}>
            <Icon name="plus" size={16} />
            Add option
          </button>
        </li>
      )}
    </ul>
  );
}
