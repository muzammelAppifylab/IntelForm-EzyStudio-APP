import {useState} from 'react';

import type {SummaryRange} from '../../../lib/intelform/api-responses';
import {buttonClass, Button, Calendar, Icon, Popover, SegmentedControl, ToggleGroup, toIsoDate} from '../../ui';
import {formatDay} from './format';

type Preset = Exclude<SummaryRange, 'custom'>;

const PRESETS: {value: Preset; label: string}[] = [
  {value: '7d', label: '7 days'},
  {value: '30d', label: '30 days'},
  {value: '90d', label: '90 days'},
  {value: 'all', label: 'All'},
];

type Edge = 'from' | 'to';

/**
 * A date range in a popover: pick the start, then the end, then "Apply" (legacy CalendarRange,
 * which used react-day-picker's two-month range mode). Used by the summary's "Custom" range and
 * the table's date filter. Days after today cannot be picked.
 */
export function CalendarRange({
  from,
  to,
  onApply,
  onClear,
  label,
  active,
}: {
  from?: string;
  to?: string;
  onApply: (from: string, to: string) => void;
  onClear?: () => void;
  label: string;
  active: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<{from?: string; to?: string}>({});
  const [edge, setEdge] = useState<Edge>('from');
  const [today] = useState(() => toIsoDate(new Date()));

  const pick = (day: string) => {
    if (edge === 'from') {
      setDraft(d => ({from: day, to: d.to && d.to >= day ? d.to : undefined}));
      setEdge('to');
    } else if (draft.from && day < draft.from) {
      setDraft(d => ({from: day, to: d.from}));
    } else {
      setDraft(d => ({from: d.from ?? day, to: day}));
    }
  };

  return (
    <Popover
      label={`${label}: choose dates`}
      wide
      align="end"
      open={open}
      onOpenChange={o => {
        setOpen(o);
        if (o) {
          setDraft({from, to});
          setEdge('from');
        }
      }}
      triggerClassName={`${buttonClass({variant: active ? 'primary' : 'secondary', size: 'sm'})} responses-range-trigger`}
      trigger={
        <>
          <Icon name="calendar" size={16} />
          {active && from && to ? `${formatDay(from)} – ${formatDay(to)}` : label}
        </>
      }>
      <div className="responses-range">
        <SegmentedControl
          label="Which end of the range"
          value={edge}
          onChange={setEdge}
          options={[
            {value: 'from', label: draft.from ? `Start: ${formatDay(draft.from)}` : 'Start'},
            {value: 'to', label: draft.to ? `End: ${formatDay(draft.to)}` : 'End'},
          ]}
        />
        <Calendar
          key={edge}
          label={edge === 'from' ? 'Choose the first day' : 'Choose the last day'}
          value={(edge === 'from' ? draft.from : draft.to ?? draft.from) ?? null}
          max={today}
          onChange={pick}
        />
        <div className="responses-range-foot">
          {onClear && active && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                onClear();
                setOpen(false);
              }}>
              Clear dates
            </Button>
          )}
          <Button
            size="sm"
            disabled={!draft.from}
            onClick={() => {
              if (!draft.from) return;
              onApply(draft.from, draft.to ?? draft.from);
              setOpen(false);
            }}>
            Apply
          </Button>
        </div>
      </div>
    </Popover>
  );
}

/** The summary's range: presets, or a custom range. */
export function RangePicker({
  range,
  from,
  to,
  onChange,
}: {
  range: SummaryRange;
  from?: string;
  to?: string;
  onChange: (range: SummaryRange, from?: string, to?: string) => void;
}) {
  return (
    <div className="responses-range-picker">
      <ToggleGroup<Preset>
        label="Date range"
        size="sm"
        value={range as Preset}
        onChange={v => onChange(v)}
        options={PRESETS}
      />
      <CalendarRange label="Custom" from={from} to={to} active={range === 'custom'} onApply={(f, t) => onChange('custom', f, t)} />
    </div>
  );
}
