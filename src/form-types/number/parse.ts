/** A number as typed: optional minus, digits, one decimal point or comma. */
export const NUMBER_RE = /^-?(\d+([.,]\d*)?|[.,]\d+)$/;

/**
 * What a number box's text means: empty (no answer), a number, or not a number yet (the
 * renderer reports `invalidNumber`).
 */
export function parseNumberText(raw: string): {kind: 'empty'} | {kind: 'number'; value: number} | {kind: 'invalid'} {
  const t = raw.trim();
  if (t === '') return {kind: 'empty'};
  if (NUMBER_RE.test(t)) return {kind: 'number', value: Number(t.replace(',', '.'))};
  return {kind: 'invalid'};
}
