import {describe, expect, it} from 'vitest';

import {bucketMedian, medianOf, planRange, summaryZone} from '../../src/server/intelform/summary/math';
import {batchSize} from '../../src/server/intelform/summary/refresh';
import {tailLimit} from '../../src/server/intelform/summary/read';

/** The pure parts of the Summary rollup: range → month / day rows, medians, zones, batch sizes. */

describe('planRange', () => {
  it('reads whole months by month and the loose days by day', () => {
    expect(planRange('2026-01-15', '2026-04-10', '2026-06-01')).toEqual({
      months: ['2026-02-01', '2026-03-01'],
      days: [
        ['2026-01-15', '2026-01-31'],
        ['2026-04-01', '2026-04-10'],
      ],
    });
    expect(planRange('2026-02-01', '2026-02-28', '2026-06-01')).toEqual({months: ['2026-02-01', '2026-02-01'], days: []});
  });

  it('counts the current month whole when the range runs to today (nothing is in the future)', () => {
    expect(planRange('2026-05-01', '2026-06-10', '2026-06-10')).toEqual({months: ['2026-05-01', '2026-06-01'], days: []});
    expect(planRange('2026-05-12', '2026-06-10', '2026-06-10')).toEqual({months: ['2026-06-01', '2026-06-01'], days: [['2026-05-12', '2026-05-31']]});
    // A range past today too.
    expect(planRange('2026-06-01', '2026-07-05', '2026-06-10')).toEqual({months: ['2026-06-01', '2026-07-01'], days: []});
  });

  it('All time starts with a whole month', () => {
    expect(planRange('2025-11-20', '2026-06-10', '2026-06-10', true)).toEqual({months: ['2025-11-01', '2026-06-01'], days: []});
  });

  it('falls back to days inside one month, a single day, and across a year end', () => {
    expect(planRange('2026-03-05', '2026-03-20', '2026-06-01')).toEqual({months: null, days: [['2026-03-05', '2026-03-20']]});
    expect(planRange('2026-03-05', '2026-03-05', '2026-06-01')).toEqual({months: null, days: [['2026-03-05', '2026-03-05']]});
    expect(planRange('2025-12-31', '2026-02-01', '2026-06-01')).toEqual({
      months: ['2026-01-01', '2026-01-01'],
      days: [
        ['2025-12-31', '2025-12-31'],
        ['2026-02-01', '2026-02-01'],
      ],
    });
    expect(planRange('2024-02-01', '2024-02-29', '2026-06-01')).toEqual({months: ['2024-02-01', '2024-02-01'], days: []});
  });
});

describe('medians', () => {
  it('matches percentile_cont(0.5) on value counts', () => {
    expect(medianOf([])).toBeNull();
    expect(medianOf([[5, 1]])).toBe(5);
    expect(medianOf([[1, 1], [3, 1]])).toBe(2);
    expect(medianOf([[3, 2], [1, 1], [10, 1]])).toBe(3);
    expect(medianOf([[1, 2], [2, 2]])).toBe(1.5);
    expect(medianOf([[-4, 1], [0, 0], [7, 2]])).toBe(7);
  });

  it('turns log buckets back into a value within half a bucket', () => {
    const r = 1.1;
    const b = String(Math.floor(Math.log(60_000) / Math.log(r)));
    const m = bucketMedian(new Map([[b, 3]]), r)!;
    expect(Math.abs(m - 60_000) / 60_000).toBeLessThan(0.05);
    expect(bucketMedian(new Map([['-1', 2]]), r)).toBe(0);
    expect(bucketMedian(new Map(), r)).toBeNull();
  });
});

describe('zones and sizes', () => {
  it('keeps a named zone Postgres knows, UTC otherwise', () => {
    expect(summaryZone('Asia/Kolkata')).toBe('Asia/Kolkata');
    expect(summaryZone('America/New_York')).toBe('America/New_York');
    expect(summaryZone('+05:30')).toBe('UTC');
    expect(summaryZone('Not/AZone')).toBe('UTC');
    expect(summaryZone('')).toBe('UTC');
    expect(summaryZone(null)).toBe('UTC');
  });

  it('bounds batches and the live read by the width of the form', () => {
    expect(batchSize(0)).toBe(2_000);
    expect(batchSize(10)).toBe(2_000);
    expect(batchSize(500)).toBe(600);
    expect(batchSize(100_000)).toBe(50);
    expect(tailLimit(10)).toBe(5_000);
    expect(tailLimit(500)).toBe(400);
    expect(tailLimit(5_000)).toBe(200);
  });
});
