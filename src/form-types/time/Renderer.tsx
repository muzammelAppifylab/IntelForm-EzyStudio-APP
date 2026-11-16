import {useState} from 'react';

import type {FieldRendererProps} from '../../respondent/types';
import {Group, NativeSelect} from '../../respondent/ui';
import {allowedHours, allowedMinutes, pad2, timeAnswer, to24} from './options';

const TWELVE_HOURS = Array.from({length: 12}, (_, i) => i + 1);

/** Hour / minute (/ AM-PM) selects built from the minute step; the answer is "HH:mm". */
export default function TimeRenderer(p: FieldRendererProps<'time'>) {
  const {field, value, onChange} = p;
  const {hourCycle, step} = field.props;
  const twelve = hourCycle === '12';
  const initial = typeof value === 'string' && /^\d{2}:\d{2}$/.test(value) ? value.split(':').map(Number) : null;
  const [hour, setHour] = useState<number | null>(initial ? initial[0]! : null);
  const [minute, setMinute] = useState<number | null>(initial ? initial[1]! : null);

  const emit = (h: number | null, m: number | null) => {
    setHour(h);
    setMinute(m);
    const next = timeAnswer(h, m);
    onChange(next.value, {invalid: next.invalid});
  };
  const period = hour === null ? 'AM' : hour < 12 ? 'AM' : 'PM';
  const displayHour = hour === null ? '' : twelve ? String(hour % 12 === 0 ? 12 : hour % 12) : String(hour);

  return (
    <Group legend={p.legend} description={p.description} error={p.error} required={field.required} legendClassName={p.large ? 'rf-question-xl' : undefined}>
      <div className="ft-time-row">
        <NativeSelect
          id={p.inputId}
          aria-label={p.labels.hour}
          invalid={p.invalid}
          className="ft-time-select"
          value={displayHour}
          onChange={e => {
            const v = e.target.value;
            if (v === '') return emit(null, minute);
            emit(twelve ? to24(Number(v), period) : Number(v), minute);
          }}>
          <option value="">--</option>
          {(twelve ? TWELVE_HOURS : allowedHours(step)).map(h => (
            <option key={h} value={h}>
              {twelve ? h : pad2(h)}
            </option>
          ))}
        </NativeSelect>
        <span aria-hidden className="ft-time-colon">
          :
        </span>
        <NativeSelect
          aria-label={p.labels.minute}
          invalid={p.invalid}
          className="ft-time-select"
          value={minute === null ? '' : String(minute)}
          onChange={e => emit(hour, e.target.value === '' ? null : Number(e.target.value))}>
          <option value="">--</option>
          {allowedMinutes(step, hour).map(m => (
            <option key={m} value={m}>
              {pad2(m)}
            </option>
          ))}
        </NativeSelect>
        {twelve && (
          <NativeSelect
            aria-label={p.labels.amPm}
            className="ft-time-select"
            value={period}
            onChange={e => {
              if (hour === null) return;
              const base = hour % 12;
              emit(e.target.value === 'PM' ? base + 12 : base, minute);
            }}>
            <option value="AM">AM</option>
            <option value="PM">PM</option>
          </NativeSelect>
        )}
      </div>
    </Group>
  );
}
