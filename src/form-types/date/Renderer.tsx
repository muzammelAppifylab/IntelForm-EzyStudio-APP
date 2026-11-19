import {lazy, type RefObject, Suspense, useEffect, useId, useLayoutEffect, useRef, useState} from 'react';

import {formatDate, isIsoDate} from '../../lib/intelform/form/types/formats';
import type {FieldRendererProps} from '../../respondent/types';
import {TextInput} from '../../respondent/ui';
import {cx, CONTROL_BOX} from '../../respondent/util';
import {FtIcon} from '../_respondent/icons';
import {dateTextToIso, maskDate} from './mask';

const DateCalendar = lazy(() => import('./DateCalendar'));

const GAP = 8;

/**
 * Floats the calendar in the browser's top layer (the popover API), so no scrolling container,
 * slide transform or dialog around the form can clip it or grow to make room for it. It stays
 * in the form's DOM, so the theme's colours still apply. Placed under the field, or above it
 * when there is more room there, kept inside the window, and re-placed on scroll and resize.
 * Without popover support it stays an absolutely positioned box under the field.
 */
function useFloating(open: boolean, anchorRef: RefObject<HTMLElement | null>, popRef: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const pop = popRef.current;
    const anchor = anchorRef.current;
    if (!open || !pop || !anchor || typeof pop.showPopover !== 'function') return;
    pop.setAttribute('popover', 'manual');
    pop.showPopover();
    let frame = 0;
    const place = () => {
      const a = anchor.getBoundingClientRect();
      const w = pop.offsetWidth;
      const h = pop.offsetHeight;
      const vw = document.documentElement.clientWidth;
      const vh = window.innerHeight;
      const below = vh - a.bottom - GAP;
      const above = a.top - GAP;
      const up = below < h && above > below;
      const top = up ? Math.max(GAP, a.top - GAP - h) : Math.max(GAP, Math.min(a.bottom + GAP, vh - h - GAP));
      const left = Math.max(GAP, Math.min(a.left, vw - w - GAP));
      pop.style.top = `${Math.round(top)}px`;
      pop.style.left = `${Math.round(left)}px`;
      pop.dataset.side = up ? 'top' : 'bottom';
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(place);
    };
    place();
    // The calendar is lazy: its size changes when it arrives (and when the month changes).
    const resize = new ResizeObserver(schedule);
    resize.observe(pop);
    window.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      window.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
      if (pop.matches(':popover-open')) pop.hidePopover();
    };
  }, [open, anchorRef, popRef]);
}

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
  const popRef = useRef<HTMLDivElement>(null);
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

  useFloating(open, wrapRef, popRef);

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
        <div ref={popRef} id={popId} role="dialog" aria-label={labels.calendar} className="ft-popover">
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
