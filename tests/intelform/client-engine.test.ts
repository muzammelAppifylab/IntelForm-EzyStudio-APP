import {describe, expect, it, vi} from 'vitest';

import {blankDefinition, newField} from '../../src/lib/intelform/form/definition';
import {matchesType} from '../../src/portal/intelform/builder/palette-search';
import {describeRule} from '../../src/portal/intelform/builder/describe';
import {accentTokens} from '../../src/portal/intelform/lib/branding';
import {checkFields, mergeErrors, TtcClock} from '../../src/respondent/engine';

const def = () => ({
  ...blankDefinition(),
  fields: [
    newField('email', {id: 'f_mail0001', label: 'Email', required: true}),
    newField('nps', {id: 'f_nps00001', label: 'NPS', required: true}),
    newField('long_text', {
      id: 'f_why00001',
      label: 'Why?',
      required: true,
      logic: {action: 'show', match: 'all', conditions: [{field: 'f_nps00001', op: 'lte', value: 6}]},
    }),
  ],
});

describe('respondent engine (pure parts)', () => {
  it('checks visible fields only, with the shared validator', () => {
    const d = def();
    const ids = d.fields.map(f => f.id);
    const empty = checkFields(d, {}, ids);
    expect(Object.keys(empty).sort()).toEqual(['f_mail0001', 'f_nps00001']);
    const detractor = checkFields(d, {f_mail0001: 'ada@example.com', f_nps00001: 3}, ids);
    expect(Object.keys(detractor)).toEqual(['f_why00001']);
    expect(checkFields(d, {f_mail0001: 'ada@example.com', f_nps00001: 9}, ids)).toEqual({});
  });

  it("a renderer's invalid code wins over the answer", () => {
    const d = def();
    const out = checkFields(d, {f_mail0001: 'ada@example.com', f_nps00001: 9}, ['f_mail0001'], {f_mail0001: 'invalidEmail'});
    expect(out.f_mail0001).toBeTruthy();
  });

  it('merges shown errors per page', () => {
    expect(mergeErrors({a: '1', b: '2'}, {b: '3'}, ['a', 'b'])).toEqual({b: '3'});
    expect(mergeErrors({a: '1', c: '9'}, {b: '3'}, ['b'])).toEqual({a: '1', c: '9', b: '3'});
    expect(mergeErrors({a: '1'}, {b: '3'})).toEqual({b: '3'});
  });

  it('times each field from enter to leave', () => {
    let t = 0;
    const spy = vi.spyOn(performance, 'now').mockImplementation(() => t);
    const clock = new TtcClock();
    clock.enter('a');
    t = 1000;
    clock.enter('b');
    t = 1500;
    expect(clock.snapshot()).toEqual({a: 1000, b: 500});
    clock.leave();
    t = 3000;
    clock.enter('a');
    t = 3200;
    expect(clock.snapshot()).toEqual({a: 1200, b: 500});
    spy.mockRestore();
  });
});

describe('builder helpers', () => {
  it('describes rules in words', () => {
    const d = def();
    expect(describeRule(d, d.fields[2].logic!)).toBe('Shown when NPS ≤ 6');
  });

  it('finds field types by extra keywords', () => {
    expect(matchesType('nps', 'recommend')).toBe(true);
    expect(matchesType('email', 'recommend')).toBe(false);
    expect(matchesType('email', '')).toBe(true);
  });

  it('accent tokens pick readable text on the accent', () => {
    expect(accentTokens('#ffe066')?.['--accent-ink']).toBe('#0e0f0f');
    expect(accentTokens('#1d3557')?.['--accent-ink']).toBe('#ffffff');
    expect(accentTokens('red')).toBeNull();
  });
});
