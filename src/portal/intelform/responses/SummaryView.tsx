import {useQuery} from '@tanstack/react-query';
import type {ReactNode} from 'react';

import type {SummaryRange, SummaryResponse} from '../../../lib/intelform/api-responses';
import {Card, ErrorNote, LoadingBlock, StatCard} from '../../ui';
import {responsesSummaryQuery} from '../queries/responses';
import {CARD_BY_KIND, type SummaryCardProps} from './cards';
import {Funnel, SeriesChart} from './charts';
import {formatDay, formatDuration, formatNumber, formatPct, plural} from './format';
import {RangePicker} from './RangePicker';
import type {SummaryState} from './state';

export interface SummaryViewProps {
  formId: string;
  state: SummaryState;
  onRange: (range: SummaryRange, from?: string, to?: string) => void;
  onFilter: (fieldId: string, value: string, range: SummaryResponse['range']) => void;
  onViewAll: (fieldId: string, range: SummaryResponse['range']) => void;
  onOpenResponse: (id: string) => void;
  /** Rendered instead of the view when the form has no responses at all. */
  empty: ReactNode;
}

/** Responses → Summary (legacy SummaryView.tsx): totals, responses per day, the funnel, one card per question. */
export function SummaryView({formId, state, onRange, onFilter, onViewAll, onOpenResponse, empty}: SummaryViewProps) {
  const {data, error, isPlaceholderData} = useQuery(responsesSummaryQuery(formId, state));

  if (error && !data) return <ErrorNote error={error} title="The summary didn’t load" />;
  if (!data) return <LoadingBlock rows={6} />;
  if (data.formTotal === 0) return <>{empty}</>;

  const t = data.totals;
  const range = data.range;
  return (
    <div className="responses-summary" aria-busy={isPlaceholderData || undefined}>
      <div className="toolbar">
        <p className="muted responses-num">
          {formatDay(range.from)} – {formatDay(range.to)}
        </p>
        <RangePicker range={state.range} from={state.from} to={state.to} onChange={onRange} />
      </div>

      <div className="responses-stats">
        <StatCard label="Views" value={formatNumber(t.views)} description="Form page loads" />
        <StatCard label="Starts" value={formatNumber(t.starts)} description="Began answering" />
        <StatCard label="Responses" value={formatNumber(t.responses)} description="Submitted" />
        <StatCard
          label="Completion rate"
          value={formatPct(t.completionRate === null ? null : t.completionRate * 100)}
          description="Responses ÷ starts"
        />
        <StatCard
          label="Avg. completion time"
          value={formatDuration(t.avgMs)}
          description={t.medianMs !== null ? `Median ${formatDuration(t.medianMs)}` : 'No timings yet'}
        />
      </div>

      <div className="responses-charts">
        <Card title="Responses over time" actions={<span className="muted responses-num">{plural(t.responses, 'response')}</span>}>
          <SeriesChart series={data.series} label={`Responses per day, ${formatDay(range.from)} to ${formatDay(range.to)}: ${plural(t.responses, 'response')} in total`} />
        </Card>
        <Funnel views={t.views} starts={t.starts} responses={t.responses} />
      </div>

      {data.questions.length === 0 ? (
        <p className="muted">This form has no questions to summarise.</p>
      ) : (
        <div className="responses-questions">
          {data.questions.map(q => {
            const QuestionCardFor = CARD_BY_KIND[q.data.kind];
            if (!QuestionCardFor) return null;
            const props: SummaryCardProps = {
              question: q,
              totalResponses: t.responses,
              onFilter: (f, v) => onFilter(f, v, range),
              onViewAll: f => onViewAll(f, range),
              onOpenResponse,
            };
            return <QuestionCardFor key={q.fieldId} {...props} />;
          })}
        </div>
      )}
    </div>
  );
}
