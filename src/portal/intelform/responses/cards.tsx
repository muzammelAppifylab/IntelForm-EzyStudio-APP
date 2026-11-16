import {useState, type ComponentType, type ReactNode} from 'react';

import type {ChoiceSummaryOption, LatestAnswer, QuestionData, QuestionSummary} from '../../../lib/intelform/api-responses';
import type {SummaryCardProps} from '../../../form-types/types';
import {Button, Icon, NpsSummaryBar} from '../../ui';
import {FIELD_ICON} from '../builder/build/field-icons';
import {formatDuration, formatNumber, formatShare, formatShortDate, plural} from './format';

/**
 * Summary cards, one per question (legacy src/pages/builder/responses/cards.tsx). Each field
 * type's `src/form-types/<type>/SummaryCard.tsx` re-exports one of these; `CARD_BY_KIND` picks
 * the same card from the data the server sent, so the summary never depends on the registry.
 * Bars are SVG sized by attributes (no inline styles: CSP).
 */

export type {SummaryCardProps};

type Of<K extends QuestionData['kind']> = Extract<QuestionData, {kind: K}>;

export function QuestionCard({question, children, action}: {question: QuestionSummary; children: ReactNode; action?: ReactNode}) {
  return (
    <section aria-labelledby={`q-${question.fieldId}`} data-testid={`summary-${question.fieldId}`} className="responses-question card-panel">
      <header className="responses-question-head">
        <div className="responses-question-title">
          <span className="responses-question-icon">
            <Icon name={FIELD_ICON[question.type] ?? 'form'} size={16} />
          </span>
          <h3 id={`q-${question.fieldId}`}>
            {question.label}
            {question.deleted && <span className="muted"> (removed)</span>}
          </h3>
          {action}
        </div>
        <p className="responses-question-meta">
          <span>{plural(question.answered, 'answer')}</span>
          {question.medianTimeMs !== null && (
            <span className="responses-question-time">
              <Icon name="timer" size={14} />
              Median time {formatDuration(question.medianTimeMs)}
            </span>
          )}
        </p>
      </header>
      {question.answered === 0 ? <p className="muted">No answers in this period.</p> : children}
    </section>
  );
}

/** A horizontal bar 0–100 % of the row's width (SVG, so no inline style). */
export function Bar({value, max, tone = 'default'}: {value: number; max: number; tone?: 'default' | 'other' | 'deleted'}) {
  const width = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <svg className="responses-bar" viewBox="0 0 100 4" preserveAspectRatio="none" aria-hidden="true">
      <rect className="responses-bar-track" width="100" height="4" rx="2" />
      {width > 0 && <rect className={`responses-bar-fill responses-bar-${tone}`} width={width} height="4" rx="2" />}
    </svg>
  );
}

/** Horizontal bars with count and %; each row opens the table filtered to that answer. */
export function ChoiceBars({
  options,
  fieldId,
  onFilter,
  limit = 12,
}: {
  options: ChoiceSummaryOption[];
  fieldId: string;
  onFilter: SummaryCardProps['onFilter'];
  limit?: number;
}) {
  const [all, setAll] = useState(false);
  const shown = all ? options : options.slice(0, limit);
  const max = Math.max(1, ...options.map(o => o.pct));
  return (
    <div className="responses-choices">
      <ul>
        {shown.map(o => (
          <li key={o.id}>
            <button
              type="button"
              className="responses-choice"
              onClick={() => onFilter(fieldId, o.id)}
              aria-label={`${o.label}: ${plural(o.count, 'answer')}, ${formatShare(o.pct)}. Show these responses`}>
              <span className="responses-choice-row">
                <span className="responses-choice-label" data-deleted={o.deleted ? '' : undefined}>
                  {o.label}
                </span>
                <span className="muted responses-num">{formatNumber(o.count)}</span>
                <span className="responses-choice-pct">{formatShare(o.pct)}</span>
              </span>
              <Bar value={o.pct} max={max} tone={o.deleted ? 'deleted' : o.other ? 'other' : 'default'} />
            </button>
          </li>
        ))}
      </ul>
      {options.length > limit && (
        <Button variant="ghost" size="sm" onClick={() => setAll(v => !v)}>
          {all ? 'Show fewer' : `Show all ${options.length}`}
        </Button>
      )}
    </div>
  );
}

function AnswerList({items, onOpen}: {items: LatestAnswer[]; onOpen: (id: string) => void}) {
  return (
    <ul className="responses-answers">
      {items.map(it => (
        <li key={it.responseId}>
          <button type="button" className="responses-answer" onClick={() => onOpen(it.responseId)}>
            <span className="responses-answer-text">{it.text}</span>
            <time className="muted responses-num" dateTime={it.submittedAt}>
              {formatShortDate(it.submittedAt)}
            </time>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function ChoiceCard(p: SummaryCardProps) {
  const d = p.question.data as Of<'choice'>;
  return (
    <QuestionCard question={p.question}>
      <ChoiceBars options={d.options} fieldId={p.question.fieldId} onFilter={p.onFilter} limit={p.question.type === 'country' ? 8 : 12} />
      {d.other.length > 0 && (
        <div className="responses-sub">
          <h4 className="responses-overline">Other answers</h4>
          <AnswerList items={d.other} onOpen={p.onOpenResponse} />
        </div>
      )}
    </QuestionCard>
  );
}

function Metric({label, value, hint}: {label: string; value: ReactNode; hint?: ReactNode}) {
  return (
    <div className="responses-metric">
      <span className="muted">{label}</span>
      <span className="responses-metric-value">{value}</span>
      {hint && <span className="muted">{hint}</span>}
    </div>
  );
}

/** Rating distribution as choice-style rows, highest first. */
export function ratingOptions(d: Of<'rating'>): ChoiceSummaryOption[] {
  const total = d.distribution.reduce((s, x) => s + x.count, 0);
  return [...d.distribution].reverse().map(x => ({
    id: String(x.value),
    label: `${x.value} ${x.value === 1 ? 'star' : 'stars'}`,
    count: x.count,
    pct: total ? Math.round((x.count / total) * 1000) / 10 : 0,
  }));
}

export function RatingCard(p: SummaryCardProps) {
  const d = p.question.data as Of<'rating'>;
  return (
    <QuestionCard question={p.question}>
      <div className="responses-metrics-row">
        <div className="responses-big">
          <span className="responses-big-value">{d.average === null ? '–' : d.average.toFixed(1)}</span>
          <span className="muted">/ {d.scale} average</span>
        </div>
        {d.csat !== null && <Metric label="CSAT (4–5 stars)" value={formatShare(d.csat)} />}
      </div>
      <ChoiceBars options={ratingOptions(d)} fieldId={p.question.fieldId} onFilter={p.onFilter} />
    </QuestionCard>
  );
}

const npsTone = (v: number) => (v <= 6 ? 'detractors' : v <= 8 ? 'passives' : 'promoters');

export function NpsCard(p: SummaryCardProps) {
  const d = p.question.data as Of<'nps'>;
  const max = Math.max(1, ...d.distribution.map(x => x.count));
  return (
    <QuestionCard question={p.question}>
      <NpsSummaryBar detractors={d.detractors} passives={d.passives} promoters={d.promoters} />
      <div className="responses-sub">
        <h4 className="responses-overline">Scores 0–10</h4>
        <ol className="responses-nps-columns">
          {d.distribution.map(x => {
            const h = x.count ? Math.max(4, (x.count / max) * 72) : 1;
            return (
              <li key={x.value}>
                <button
                  type="button"
                  className="responses-nps-column"
                  onClick={() => p.onFilter(p.question.fieldId, String(x.value))}
                  aria-label={`Score ${x.value}: ${plural(x.count, 'answer')}. Show these responses`}>
                  <span className="muted responses-num">{x.count || ''}</span>
                  <svg viewBox="0 0 10 72" preserveAspectRatio="none" aria-hidden="true">
                    <rect className={`nps-${npsTone(x.value)}`} x="0" y={72 - h} width="10" height={h} rx="1" />
                  </svg>
                  <span className="muted responses-num">{x.value}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>
    </QuestionCard>
  );
}

export function NumberCard(p: SummaryCardProps) {
  const d = p.question.data as Of<'number'>;
  const f = (n: number | null) => (n === null ? '–' : formatNumber(n));
  return (
    <QuestionCard question={p.question}>
      <div className="responses-metrics">
        <Metric label="Average" value={f(d.average)} />
        <Metric label="Median" value={f(d.median)} />
        <Metric label="Min" value={f(d.min)} />
        <Metric label="Max" value={f(d.max)} />
      </div>
    </QuestionCard>
  );
}

export function LatestCard(p: SummaryCardProps) {
  const d = p.question.data as Of<'latest'>;
  return (
    <QuestionCard
      question={p.question}
      action={
        p.question.answered > 0 && (
          <Button variant="ghost" size="sm" iconEnd="arrow-right" onClick={() => p.onViewAll(p.question.fieldId)} aria-label={`View all answers to ${p.question.label}`}>
            View all
          </Button>
        )
      }>
      <div className="responses-sub">
        <h4 className="responses-overline">Latest answers</h4>
        <AnswerList items={d.items} onOpen={p.onOpenResponse} />
      </div>
    </QuestionCard>
  );
}

export function CountCard(p: SummaryCardProps) {
  const d = p.question.data as Of<'count'>;
  const pct = p.totalResponses ? Math.round((d.count / p.totalResponses) * 100) : 0;
  return (
    <QuestionCard question={p.question}>
      <div className="responses-big">
        <span className="responses-big-value">{formatNumber(d.count)}</span>
        <span className="muted">
          {d.noun} · {pct}% of responses
        </span>
      </div>
    </QuestionCard>
  );
}

/** The card for a question's summary data (the same pairing as the per-type SummaryCard files). */
export const CARD_BY_KIND: Record<QuestionData['kind'], ComponentType<SummaryCardProps>> = {
  choice: ChoiceCard,
  rating: RatingCard,
  nps: NpsCard,
  number: NumberCard,
  latest: LatestCard,
  count: CountCard,
};
