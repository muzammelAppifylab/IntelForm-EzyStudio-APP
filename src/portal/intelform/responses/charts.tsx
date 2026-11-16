import {formatDay, formatNumber, formatPct} from './format';

/**
 * The summary's two charts without a chart library (legacy used recharts): an SVG line of
 * responses per day and a three-step funnel. Sized by SVG attributes only (CSP: no inline style).
 */

const W = 640;
const H = 220;
const PAD = {left: 36, right: 12, top: 12, bottom: 28};

/** Nice y-axis top: 1, 2, 5 × 10^n at or above `max` (at least 4, so small counts still read). */
export function niceMax(max: number): number {
  if (max <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(max));
  for (const m of [1, 2, 5, 10]) if (m * pow >= max) return m * pow;
  return 10 * pow;
}

/** Indexes of up to `count` evenly spaced x labels (first and last always included). */
export function tickIndexes(length: number, count = 5): number[] {
  if (length <= 0) return [];
  if (length <= count) return Array.from({length}, (_, i) => i);
  const out = new Set<number>();
  for (let i = 0; i < count; i++) out.add(Math.round((i * (length - 1)) / (count - 1)));
  return [...out];
}

export function SeriesChart({series, label}: {series: {day: string; count: number}[]; label: string}) {
  const top = niceMax(Math.max(0, ...series.map(s => s.count)));
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (series.length <= 1 ? innerW / 2 : (i / (series.length - 1)) * innerW);
  const y = (v: number) => PAD.top + innerH - (v / top) * innerH;
  const line = series.map((s, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(s.count).toFixed(1)}`).join(' ');
  const area = series.length ? `${line} L${x(series.length - 1).toFixed(1)} ${y(0)} L${x(0).toFixed(1)} ${y(0)} Z` : '';
  const yTicks = [0, top / 2, top];
  const dots = series.length <= 31;
  return (
    <svg className="responses-series" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      {yTicks.map(t => (
        <g key={t}>
          <line className="responses-series-grid" x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} />
          <text className="responses-series-tick" x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end">
            {formatNumber(t)}
          </text>
        </g>
      ))}
      {tickIndexes(series.length).map(i => (
        <text key={i} className="responses-series-tick" x={x(i)} y={H - 8} textAnchor={i === 0 ? 'start' : i === series.length - 1 ? 'end' : 'middle'}>
          {formatDay(series[i]!.day)}
        </text>
      ))}
      {series.length > 1 && <path className="responses-series-area" d={area} />}
      {series.length > 1 && <path className="responses-series-line" d={line} />}
      {(dots || series.length === 1) &&
        series.map((s, i) => (
          <circle key={s.day} className="responses-series-dot" cx={x(i)} cy={y(s.count)} r="3">
            <title>{`${formatDay(s.day)}: ${formatNumber(s.count)}`}</title>
          </circle>
        ))}
    </svg>
  );
}

/** A 3-step funnel, not a "drop-off" chart: there is no per-question reach data. */
export function Funnel({views, starts, responses}: {views: number; starts: number; responses: number}) {
  const steps = [
    {label: 'Views', n: views},
    {label: 'Starts', n: starts},
    {label: 'Responses', n: responses},
  ];
  const max = Math.max(1, views, starts, responses);
  return (
    <section aria-labelledby="responses-funnel" className="card-panel responses-funnel">
      <h3 id="responses-funnel">Views → Starts → Responses</h3>
      <ol>
        {steps.map((s, i) => {
          const prev = i > 0 ? steps[i - 1]!.n : null;
          return (
            <li key={s.label}>
              <div className="responses-funnel-row">
                <span className="responses-funnel-label">{s.label}</span>
                <span className="responses-funnel-value">{formatNumber(s.n)}</span>
                {prev !== null && <span className="muted responses-funnel-pct">{prev > 0 ? formatPct(Math.min(100, (s.n / prev) * 100)) : '–'}</span>}
              </div>
              <svg className="responses-bar" viewBox="0 0 100 4" preserveAspectRatio="none" aria-hidden="true">
                <rect className="responses-bar-track" width="100" height="4" rx="2" />
                {s.n > 0 && <rect className="responses-bar-fill responses-bar-default" width={(s.n / max) * 100} height="4" rx="2" />}
              </svg>
            </li>
          );
        })}
      </ol>
      <p className="muted responses-small">Percentages compare each step with the one before it.</p>
    </section>
  );
}
