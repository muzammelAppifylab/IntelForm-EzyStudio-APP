import {describe, expect, it} from 'vitest';

import {formButtonClass, iconButtonClass, inputClass, smallButtonClass} from '../../src/respondent/classes';
import {CONTROL, CONTROL_BOX, cx, guessCountry, shuffled} from '../../src/respondent/util';

const noDupes = (classes: string) => {
  const parts = classes.split(/\s+/).filter(Boolean);
  expect(parts.length).toBe(new Set(parts).size);
};

describe('respondent classes', () => {
  it('builds each control from one base and one variant, no duplicates', () => {
    expect(inputClass()).toBe(`rf-input ${CONTROL}`);
    expect(inputClass('rf-narrow')).toBe(`rf-input ${CONTROL} rf-narrow`);
    expect(CONTROL.startsWith(CONTROL_BOX)).toBe(true);
    expect(formButtonClass()).toBe('rf-button rf-button-primary rf-button-form');
    expect(formButtonClass('outline', 'rf-fit')).toBe('rf-button rf-button-outline rf-button-form rf-fit');
    for (const c of [inputClass(), formButtonClass(), formButtonClass('outline'), iconButtonClass, smallButtonClass]) noDupes(c);
  });

  it('cx skips falsy parts', () => {
    expect(cx('a', false, null, undefined, 0, '', 'b')).toBe('a b');
  });
});

describe('respondent util', () => {
  it('shuffles the same way for the same seed and keeps every item', () => {
    const items = ['a', 'b', 'c', 'd', 'e', 'f'];
    const one = shuffled(items, 42);
    expect(shuffled(items, 42)).toEqual(one);
    expect([...one].sort()).toEqual(items);
    expect(items).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });

  it('guesses the country from the browser languages', () => {
    expect(guessCountry(['de', 'en-GB'])).toBe('GB');
    expect(guessCountry(['fr'])).toBeNull();
    expect(guessCountry(['pt-br'])).toBe('BR');
  });
});
