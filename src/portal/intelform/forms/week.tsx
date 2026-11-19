import {Link} from '@tanstack/react-router';

import {FORM_STATUS_LABEL, type FormsStrip} from '../../../lib/intelform/api-forms';
import {Card, Skeleton, StatCard} from '../../ui';
import {useAbilities} from '../lib/can';
import {formatDay} from '../responses/format';
import {barHeights, daysSummary, formatCount, formatRate, plural, weekday, weekTrend} from './format';

/** The three numbers of the week: responses (against last week), live forms, average completion. */
export function WeekStats({strip}: {strip: FormsStrip | undefined}) {
  const trend = strip ? weekTrend(strip.responsesThisWeek, strip.responsesLastWeek) : null;
  return (
    <div className="stat-grid if-week-stats">
      <StatCard
        label="Responses, last 7 days"
        icon="inbox"
        tone="chamber"
        value={strip ? formatCount(strip.responsesThisWeek) : null}
        delta={trend && trend.trend !== 'flat' ? {value: trend.value, trend: trend.trend, period: 'vs the 7 days before'} : undefined}
        description={trend && trend.trend === 'flat' ? trend.sentence : undefined}
      />
      <StatCard
        label="Live forms"
        icon="form"
        value={strip ? formatCount(strip.counts.live) : null}
        description={strip ? `of ${formatCount(strip.counts.all)} total` : undefined}
      />
      <StatCard
        label="Avg. completion"
        icon="gauge"
        value={strip ? formatRate(strip.avgCompletion) : null}
        description="Across forms people have started"
      />
    </div>
  );
}

/**
 * Responses per day for the last 7 days: one column per day, each its own SVG bar (sized by SVG
 * attributes, CSP: no inline style), today highlighted. Hovering a column lights its bar and shows
 * the day and its count; screen readers get the same numbers from the caption.
 */
export function DayBars({days}: {days: FormsStrip['days']}) {
  if (days.length === 0) return <p className="muted">No data yet.</p>;
  const {top, heights} = barHeights(days);
  const today = days.at(-1);
  const last = days.length - 1;
  return (
    <figure className="if-day-bars">
      <figcaption className="visually-hidden">{daysSummary(days)}</figcaption>
      {today && (
        <p className="if-day-bars-today" aria-hidden="true">
          Today so far · {formatCount(today.count)}
        </p>
      )}
      <div className="if-day-bars-plot" aria-hidden="true">
        <span className="if-day-bars-axis">
          <span>{top}</span>
          <span>{top / 2}</span>
          <span>0</span>
        </span>
        <div className="if-day-bars-area">
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="if-day-bars-grid">
            <line x1="0" x2="100" y1="0.5" y2="0.5" className="if-grid-dash" vectorEffect="non-scaling-stroke" />
            <line x1="0" x2="100" y1="50" y2="50" className="if-grid-dash" vectorEffect="non-scaling-stroke" />
            <line x1="0" x2="100" y1="99.5" y2="99.5" className="if-grid-base" vectorEffect="non-scaling-stroke" />
          </svg>
          <div className="if-day-bars-cols">
            {days.map((d, i) => (
              <div key={d.date} className="if-day-col" data-today={i === last ? '' : undefined}>
                <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="if-day-col-svg">
                  <rect x={18} width={64} y={100 - heights[i]!} height={heights[i]} rx={3} className={i === last ? 'if-bar if-bar-today' : 'if-bar'} />
                </svg>
                <span className="if-day-tip">
                  {i === last ? 'Today' : `${weekday(d.date)} ${formatDay(d.date)}`} · {plural(d.count, 'response')}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <ol className="if-day-bars-labels" aria-hidden="true">
        {days.map((d, i) => (
          <li key={d.date} data-today={i === last ? '' : undefined}>
            {i === last ? 'Today' : weekday(d.date)}
          </li>
        ))}
      </ol>
    </figure>
  );
}

/** Up to three forms with the most responses this week, linking to their responses. */
export function MostActive({strip}: {strip: FormsStrip}) {
  const {viewResponses} = useAbilities();
  if (strip.mostActive.length === 0) return <p className="muted">No new responses in the last 7 days.</p>;
  return (
    <ol className="list if-ranked">
      {strip.mostActive.map((f, i) => (
        <li key={f.id}>
          <span className="if-ranked-n" aria-hidden="true">
            {i + 1}
          </span>
          <span className="if-ranked-text">
            {viewResponses ? (
              <Link to="/forms/$formId/responses" params={{formId: f.id}}>
                {f.title}
              </Link>
            ) : (
              <Link to="/forms/$formId/build" params={{formId: f.id}}>
                {f.title}
              </Link>
            )}
            <span className="muted">
              {FORM_STATUS_LABEL[f.status]}
              {f.completionRate !== null && ` · ${formatRate(f.completionRate)} completion`}
            </span>
          </span>
          <span className="if-ranked-count">
            +{formatCount(f.count)}
            <span className="visually-hidden"> new {f.count === 1 ? 'response' : 'responses'}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

/** The weekly strip above the forms list: the numbers, then the days beside the most active forms. */
export function WeekStrip({strip}: {strip: FormsStrip | undefined}) {
  return (
    <div className="if-week">
      <WeekStats strip={strip} />
      <div className="grid-main-side">
        <Card title="Responses per day" description="Last 7 days">
          {strip ? <DayBars days={strip.days} /> : <Skeleton lines={5} />}
        </Card>
        <Card title="Most new responses" description={strip ? `This week · ${plural(strip.responsesThisWeek, 'response')}` : 'This week'}>
          {strip ? <MostActive strip={strip} /> : <Skeleton lines={3} />}
        </Card>
      </div>
    </div>
  );
}
