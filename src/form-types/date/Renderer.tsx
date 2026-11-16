import {lazy, Suspense, useEffect, useId, useRef, useState} from 'react';

import {formatDate, isIsoDate} from '../../lib/intelform/form/types/basic';
import type {FieldRendererProps} from '../../respondent/types';
import {TextInput} from '../../respondent/ui';
import {cx, CONTROL_BOX} from '../../respondent/util';
import {FtIcon} from '../_respondent/icons';
import {dateTextToIso, maskDate} from './mask';

const DateCalendar = lazy(() => import('./DateCalendar'));

/**
 * A masked text input in the field's display format (a native date input can't be forced to
 * DD/MM/YYYY) plus a calendar popover loaded on first open. Stored as "YYYY-MM-DD".
 */
export default function DateRenderer({field, value, onChange, labels, inputId, describedBy, invalid, onAdvance}: FieldRendererProps<'date'>) {
  const {format} = field.props;
  const [text, setText] = useState(() => (typeof value === 'string' && isIsoDate(value) ? formatDate(value, format) : ''));
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const hintId = useId();
  const popId = useId();

  const update = (raw: string) => {
    const masked = maskDate(raw, format);
    setText(masked);
    if (masked === '') return onChange(undefined, {invalid: null});
    const iso = dateTextToIso(masked, format);
    if (iso) onChange(iso, {invalid: null});
    else onChange(undefined, {invalid: 'invalidDate'});
  };

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  return (
    <div
      ref={wrapRef}
      className="ft-date"
      onKeyDown={e => {
        if (e.key === 'Escape' && open) {
          e.preventDefault();
          e.stopPropagation();
          setOpen(false);
          buttonRef.current?.focus();
        }
      }}>
      <TextInput
        id={inputId}
        inputMode="numeric"
        autoComplete="off"
        placeholder={format}
        aria-describedby={[hintId, describedBy].filter(Boolean).join(' ')}
        aria-required={field.required || undefined}
        invalid={invalid}
        value={text}
        onValueChange={update}
        onAdvance={onAdvance}
        className="ft-tabular"
      />
      <span id={hintId} className="ft-sr-only">
        {format}
      </span>
      <button
        ref={buttonRef}
        type="button"
        aria-label={labels.openCalendar}
        aria-expanded={open}
        aria-controls={open ? popId : undefined}
        onClick={() => setOpen(o => !o)}
        className={cx(CONTROL_BOX, 'ft-date-button')}>
        <FtIcon name="calendar" />
      </button>
      {open && (
        <div id={popId} role="dialog" aria-label={labels.calendar} className="ft-popover">
          <Suspense fallback={<div className="ft-calendar-placeholder" />}>
            <DateCalendar
              selected={typeof value === 'string' && isIsoDate(value) ? value : null}
              minDate={field.props.minDate}
              maxDate={field.props.maxDate}
              disablePast={field.props.disablePast}
              disableFuture={field.props.disableFuture}
              onSelect={iso => {
                setText(formatDate(iso, format));
                onChange(iso, {invalid: null});
                setOpen(false);
                buttonRef.current?.focus();
              }}
            />
          </Suspense>
        </div>
      )}
    </div>
  );
}
