import {describe, expect, it} from 'vitest';

import {blankDefinition, type FormDefinition, type FormField, newField} from '../../src/lib/intelform/form/definition';
import {FIELD_TYPES} from '../../src/lib/intelform/form/field-types';
import {editorNames} from '../../src/portal/intelform/builder/Banners';
import {canvasSummary, issuesByField, questionNumbers} from '../../src/portal/intelform/builder/build/Canvas';
import {describeDependents} from '../../src/portal/intelform/builder/build/DeleteDialog';
import {FIELD_ICON} from '../../src/portal/intelform/builder/build/field-icons';
import {paletteGroups} from '../../src/portal/intelform/builder/build/Palette';
import {parseNumberValue} from '../../src/portal/intelform/builder/condition-inputs';
import {numberError} from '../../src/portal/intelform/builder/controls';
import {countrySummary} from '../../src/portal/intelform/builder/CountryPicker';
import {MAX_OPTIONS, moveOption, pasteOptionLines, splitLines} from '../../src/portal/intelform/builder/OptionsEditor';
import {PublishBlocked, publishFailure, publishProblems} from '../../src/portal/intelform/builder/PublishButton';
import {TABS, tabFromPath} from '../../src/portal/intelform/builder/tabs';
import {ApiRequestError} from '../../src/portal/intelform/lib/api';
import {ICON_NAMES} from '../../src/portal/ui';

function def(fields: FormField[], extra: Partial<FormDefinition> = {}): FormDefinition {
  return {...blankDefinition(), fields, ...extra};
}

const email = () => newField('email', {id: 'f_email', label: 'Email'});
const name = () => newField('short_text', {id: 'f_name', label: 'Name'});
const section = () => newField('section_break', {id: 'f_sec', label: 'Part two'});

describe('tabs', () => {
  it('reads the tab from the dashboard path', () => {
    expect(tabFromPath('/dashboard/forms/abc/design')).toBe('design');
    expect(tabFromPath('/forms/abc/responses/')).toBe('responses');
    expect(tabFromPath('/forms/abc')).toBeNull();
  });

  it('has the five tabs in order, each with a literal child route', () => {
    expect(TABS.map(t => t.id)).toEqual(['build', 'design', 'settings', 'share', 'responses']);
    for (const t of TABS) expect(t.to).toBe(`/forms/$formId/${t.id}`);
  });
});

describe('field icons', () => {
  it('names a kit icon for every field type', () => {
    for (const t of FIELD_TYPES) expect(ICON_NAMES).toContain(FIELD_ICON[t]);
  });
});

describe('publish checks', () => {
  it('blocks a form without questions (a section break alone does not count)', () => {
    expect(publishProblems(def([]))).toEqual([{message: 'Add at least one question before you publish.'}]);
    expect(publishProblems(def([section()]))).toHaveLength(1);
    expect(publishProblems(def([name()]))).toEqual([]);
  });

  it('lists broken logic with the field it is on', () => {
    const later = newField('short_text', {id: 'f_later', label: 'Later'});
    const target = newField('short_text', {
      id: 'f_target',
      label: 'Target',
      logic: {action: 'show', match: 'all', conditions: [{field: 'f_later', op: 'is_not_empty'}]},
    });
    const problems = publishProblems(def([target, later]));
    expect(problems).toHaveLength(1);
    expect(problems[0]!.fieldId).toBe('f_target');
  });

  it('checks "one response per email" when settings are given', () => {
    const settings = {onePerEmail: true, onePerEmailFieldId: 'f_missing'};
    expect(publishProblems(def([email()]), settings).length).toBeGreaterThan(0);
    const required = newField('email', {id: 'f_email', label: 'Email', required: true});
    expect(publishProblems(def([required]), {onePerEmail: true, onePerEmailFieldId: 'f_email'})).toEqual([]);
  });

  it('turns a 422 into PublishBlocked with the server issues (template and legacy shapes)', () => {
    const top = publishFailure(422, {error: 'logic_issues', message: 'Fix the logic', issues: [{message: 'A', fieldId: 'f1'}, {message: 'B'}]});
    expect(top).toBeInstanceOf(PublishBlocked);
    expect((top as PublishBlocked).problems).toEqual([{message: 'A', fieldId: 'f1'}, {message: 'B'}]);

    const legacy = publishFailure(422, {error: {code: 'logic_issues', message: 'x', issues: [{message: 'C', fieldId: 'f2'}]}});
    expect((legacy as PublishBlocked).problems).toEqual([{message: 'C', fieldId: 'f2'}]);

    const bare = publishFailure(422, {error: 'empty_form', message: 'Add a question first'});
    expect((bare as PublishBlocked).problems).toEqual([{message: 'Add a question first'}]);
  });

  it('turns other failures into ApiRequestError', () => {
    const err = publishFailure(403, {error: 'forbidden', message: 'Not allowed'});
    expect(err).toBeInstanceOf(ApiRequestError);
    expect(err.message).toBe('Not allowed');
    expect((err as ApiRequestError).status).toBe(403);
    expect(publishFailure(500, null).message).toBe('Publishing failed. Try again.');
  });
});

describe('banners', () => {
  it('names the other editors', () => {
    expect(editorNames([{name: 'Sam', self: false}])).toBe('Sam');
    expect(editorNames([{name: 'Me', self: true}, {name: 'Sam', self: false}, {name: 'Alex', self: false}])).toBe(
      'You, in another tab,, Sam and Alex'
    );
  });
});

describe('canvas', () => {
  it('numbers questions and skips section breaks', () => {
    expect(questionNumbers([name(), section(), email()])).toEqual([1, null, 2]);
  });

  it('summarises questions, rules and layout', () => {
    const withRule = newField('short_text', {
      id: 'f_r',
      label: 'R',
      logic: {action: 'show', match: 'all', conditions: [{field: 'f_name', op: 'is_not_empty'}]},
    });
    expect(canvasSummary(def([name(), section(), withRule], {layout: 'one_at_a_time'}))).toBe('2 questions · 1 logic rule · One at a time');
    expect(canvasSummary(def([]))).toMatch(/^0 questions · 0 logic rules · /);
  });

  it('groups lint issues by field', () => {
    const target = newField('short_text', {
      id: 'f_t',
      label: 'T',
      logic: {action: 'show', match: 'all', conditions: [{field: 'f_gone', op: 'is_not_empty'}]},
    });
    const map = issuesByField(def([target]));
    expect(map.get('f_t')).toHaveLength(1);
    expect(map.get('f_other')).toBeUndefined();
  });
});

describe('delete dialog', () => {
  it('lists the rules that use a question', () => {
    const target = newField('short_text', {
      id: 'f_t',
      label: 'Company',
      logic: {action: 'show', match: 'all', conditions: [{field: 'f_name', op: 'is_not_empty'}]},
    });
    const deps = describeDependents(def([name(), target]), 'f_name');
    expect(deps).toHaveLength(1);
    expect(deps[0]!.where).toBe('Company');
    expect(deps[0]!.what).toContain('Name');
    expect(describeDependents(def([name()]), 'f_name')).toEqual([]);
  });
});

describe('palette', () => {
  it('shows every type without a search, grouped', () => {
    expect(paletteGroups('').flatMap(g => g.types).sort()).toEqual([...FIELD_TYPES].sort());
  });

  it('filters by name and keeps only groups with a match', () => {
    const groups = paletteGroups('email');
    expect(groups.flatMap(g => g.types)).toContain('email');
    expect(groups.every(g => g.types.length > 0)).toBe(true);
    expect(paletteGroups('zzzz-no-such-type')).toEqual([]);
  });
});

describe('options editor', () => {
  const opts = [
    {id: 'a', label: 'A'},
    {id: 'b', label: 'B'},
    {id: 'c', label: 'C'},
  ];
  let n = 0;
  const make = (label: string) => ({id: `new${++n}`, label});

  it('splits pasted text into trimmed non-empty lines', () => {
    expect(splitLines(' Red \r\n\nGreen\n  \nBlue')).toEqual(['Red', 'Green', 'Blue']);
  });

  it('moves an option, ignoring moves out of range', () => {
    expect(moveOption(opts, 0, 2).map(o => o.id)).toEqual(['b', 'c', 'a']);
    expect(moveOption(opts, 2, 0).map(o => o.id)).toEqual(['c', 'a', 'b']);
    expect(moveOption(opts, 0, -1).map(o => o.id)).toEqual(['a', 'b', 'c']);
    expect(moveOption(opts, 1, 3).map(o => o.id)).toEqual(['a', 'b', 'c']);
  });

  it('turns a multi-line paste into new options after the one pasted into', () => {
    const next = pasteOptionLines(opts, 1, 'X\nY\nZ', make)!;
    expect(next.map(o => o.label)).toEqual(['A', 'X', 'Y', 'Z', 'C']);
    expect(next[1]!.id).toBe('b');
    expect(pasteOptionLines(opts, 1, 'single line', make)).toBeNull();
  });

  it('caps the list at the maximum', () => {
    const many = Array.from({length: MAX_OPTIONS - 1}, (_, i) => ({id: `o${i}`, label: `${i}`}));
    const next = pasteOptionLines(many, 0, 'a\nb\nc\nd', make)!;
    expect(next).toHaveLength(MAX_OPTIONS);
  });
});

describe('controls', () => {
  it('checks number boxes', () => {
    expect(numberError('', {min: 1})).toBeNull();
    expect(numberError('1.5', {})).toBe('Enter a whole number');
    expect(numberError('1.5', {integer: false})).toBeNull();
    expect(numberError('abc', {integer: false})).toBe('Enter a number');
    expect(numberError('0', {min: 1})).toBe('Enter 1 or more');
    expect(numberError('11', {max: 10})).toBe('Enter 10 or less');
  });

  it('parses condition numbers, keeping text that is not one', () => {
    expect(parseNumberValue('')).toBeUndefined();
    expect(parseNumberValue(' 42 ')).toBe(42);
    expect(parseNumberValue('-1.5')).toBe(-1.5);
    expect(parseNumberValue('.5')).toBe(0.5);
    expect(parseNumberValue('1e3')).toBe('1e3');
    expect(parseNumberValue('12a')).toBe('12a');
  });

  it('summarises a country selection', () => {
    expect(countrySummary([])).toBe('All countries');
    expect(countrySummary(['FR'])).toBe('France');
    expect(countrySummary(['FR', 'DE', 'IT', 'ES'])).toBe('4 countries');
  });
});
