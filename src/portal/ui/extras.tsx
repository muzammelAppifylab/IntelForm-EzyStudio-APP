import {type ReactNode, useEffect, useId, useRef, useState} from 'react';

import {Skeleton} from './display';
import {Icon, type IconName} from './icon';

/**
 * Smaller pieces IntelForm's screens need: `Collapsible` (a section that opens
 * and closes), `ScrollArea` (a bounded, keyboard-scrollable box), `Spinner`
 * (busy, with words for screen readers), `StatCard` (a KPI with a delta, or a
 * dark "chamber" hero) and `CopyField` (a read-only value with a Copy button:
 * a link, an embed code).
 */

// -------------------------------------------------------------- collapsible --

/** A titled section that opens and closes (advanced settings, a logic rule). */
export function Collapsible({
  title,
  description,
  children,
  defaultOpen = false,
  open: openProp,
  onOpenChange,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Controls beside the title (outside the toggle button). */
  actions?: ReactNode;
}) {
  const [own, setOwn] = useState(defaultOpen);
  const open = openProp ?? own;
  const id = useId();
  return (
    <div className="collapsible" data-open={open ? '' : undefined}>
      <div className="collapsible-head">
        <button
          type="button"
          className="collapsible-trigger"
          aria-expanded={open}
          aria-controls={`${id}-panel`}
          onClick={() => {
            if (openProp === undefined) setOwn(!open);
            onOpenChange?.(!open);
          }}>
          <Icon name="chevron-right" size={16} className="collapsible-chevron" />
          <span className="collapsible-text">
            <span className="collapsible-title">{title}</span>
            {description && <span className="collapsible-description">{description}</span>}
          </span>
        </button>
        {actions && <div className="collapsible-actions">{actions}</div>}
      </div>
      <div className="collapsible-panel" id={`${id}-panel`} hidden={!open}>
        {children}
      </div>
    </div>
  );
}

// -------------------------------------------------------------- scroll area --

/** A box with its own scroll (a long list in a side panel); focusable so the keyboard can scroll it. */
export function ScrollArea({label, size = 'md', children}: {label: string; size?: 'sm' | 'md' | 'lg' | 'fill'; children: ReactNode}) {
  return (
    <div className={`scroll-area scroll-area-${size}`} role="region" aria-label={label} tabIndex={0}>
      {children}
    </div>
  );
}

// ------------------------------------------------------------------ spinner --

/** Busy, in place (a panel loading a preview). Lists and cards prefer `LoadingBlock`. */
export function Spinner({label = 'Loading…', size = 'md', showLabel}: {label?: string; size?: 'sm' | 'md' | 'lg'; showLabel?: boolean}) {
  return (
    <span className={`spinner-wrap spinner-${size}`} role="status">
      <span className="spinner" aria-hidden="true" />
      <span className={showLabel ? 'spinner-label' : 'visually-hidden'}>{label}</span>
    </span>
  );
}

// ---------------------------------------------------------------- stat card --

export type StatDelta = {
  /** Display text ("12%", "4"); the sign comes from `trend`. */
  value: string;
  trend: 'up' | 'down' | 'flat';
  /** Whether "up" is good for this number (default true; a drop-off rate passes false). */
  upIsGood?: boolean;
  /** "vs last 7 days". */
  period?: string;
};
const TREND_ICON = {up: 'arrow-up-right', down: 'arrow-down-right', flat: 'arrow-right'} as const;
const TREND_WORD = {up: 'Up', down: 'Down', flat: 'No change,'} as const;

/**
 * A KPI tile: label, the number in the display serif, an optional delta that
 * pairs colour with an arrow AND a word. `tone="chamber"` is the dark hero
 * card (one per screen). `value={null}` shows a skeleton. Cheap numbers only
 * (performance.md); for a linked overview tile, `Stat`.
 */
export function StatCard({
  label,
  value,
  icon,
  delta,
  description,
  tone = 'default',
}: {
  label: ReactNode;
  value: ReactNode | null;
  icon?: IconName;
  delta?: StatDelta;
  description?: ReactNode;
  tone?: 'default' | 'chamber';
}) {
  const good = delta && delta.trend !== 'flat' && (delta.trend === 'up') === (delta.upIsGood ?? true);
  return (
    <div className={`stat-card stat-card-${tone}`}>
      <div className="stat-card-top">
        <span className="stat-card-label">{label}</span>
        {icon && <Icon name={icon} size={16} />}
      </div>
      <div className="stat-card-value">{value === null ? <Skeleton width="half" /> : value}</div>
      {(delta || description) && (
        <div className="stat-card-foot">
          {delta && (
            <span className="stat-card-delta" data-trend={delta.trend} data-good={good ? '' : undefined}>
              <Icon name={TREND_ICON[delta.trend]} size={14} />
              <span className="visually-hidden">{TREND_WORD[delta.trend]} </span>
              {delta.value}
            </span>
          )}
          {delta?.period && <span>{delta.period}</span>}
          {description && <span>{description}</span>}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- copy field --

/**
 * A value to copy (a form's link, an embed code): read-only, selectable, with a
 * Copy button that says "Copied" for a moment. `multiline` for code.
 */
export function CopyField({id, label, value, multiline, hint}: {id?: string; label: ReactNode; value: string; multiline?: boolean; hint?: ReactNode}) {
  const own = useId();
  const fieldId = id ?? own;
  const [copied, setCopied] = useState<'yes' | 'failed' | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied('yes');
    } catch {
      setCopied('failed');
    }
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(null), 2000);
  };
  return (
    <div className="field copy-field">
      <label htmlFor={fieldId}>{label}</label>
      <div className="copy-field-row">
        {multiline ? (
          <textarea id={fieldId} readOnly value={value} rows={4} onFocus={event => event.currentTarget.select()} />
        ) : (
          <input id={fieldId} readOnly value={value} onFocus={event => event.currentTarget.select()} />
        )}
        <button type="button" className="button button-secondary" onClick={() => void copy()} aria-describedby={`${fieldId}-copied`}>
          <Icon name={copied === 'yes' ? 'check' : 'copy'} size={16} />
          {copied === 'yes' ? 'Copied' : 'Copy'}
        </button>
      </div>
      <p className="field-hint" id={`${fieldId}-copied`} aria-live="polite">
        {copied === 'failed' ? 'Could not copy: select the text and copy it yourself.' : hint}
      </p>
    </div>
  );
}
