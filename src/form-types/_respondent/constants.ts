/** Letters for keyboard selection: A–Z. Options past the 26th get no key. */
export const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Value stored for the "Other" tile in a choice group; its free text travels separately. */
export const OTHER_VALUE = '__other__';

/** The next checkbox selection after ticking or unticking `value` (ticked values go last). */
export function toggleValue(current: readonly string[], value: string, checked: boolean): string[] {
  const rest = current.filter(x => x !== value);
  return checked ? [...rest, value] : rest;
}
