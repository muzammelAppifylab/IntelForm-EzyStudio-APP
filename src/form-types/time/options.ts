/** The hour / minute choices of the time field for a minute step (pure; unit tested). */

export const pad2 = (n: number) => String(n).padStart(2, '0');

/** Minutes 0, step, 2·step… below 60. */
export function stepMinutes(step: number): number[] {
  const out: number[] = [];
  for (let m = 0; m < 60; m += Math.max(1, step)) out.push(m);
  return out;
}

/**
 * Minutes allowed in an hour. With a step that doesn't divide the hour, only times on the step
 * from 00:00 are valid.
 */
export function allowedMinutes(step: number, hour: number | null): number[] {
  const minutes = stepMinutes(step);
  return 60 % step === 0 || hour === null ? minutes : minutes.filter(m => (hour * 60 + m) % step === 0);
}

/** Hours (0–23) that have at least one valid minute. */
export function allowedHours(step: number): number[] {
  const minutes = stepMinutes(step);
  return Array.from({length: 24}, (_, h) => h).filter(h => 60 % step === 0 || minutes.some(m => (h * 60 + m) % step === 0));
}

/** "HH:mm" when both parts are picked; `invalid` when only one is. */
export function timeAnswer(hour: number | null, minute: number | null): {value: string | undefined; invalid: string | null} {
  if (hour === null && minute === null) return {value: undefined, invalid: null};
  if (hour === null || minute === null) return {value: undefined, invalid: 'invalidTime'};
  return {value: `${pad2(hour)}:${pad2(minute)}`, invalid: null};
}

/** A 12-hour clock pick (1–12 plus AM/PM) as a 0–23 hour. */
export const to24 = (hour12: number, period: 'AM' | 'PM') => (hour12 % 12) + (period === 'PM' ? 12 : 0);
