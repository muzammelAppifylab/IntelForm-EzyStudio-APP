import {createElement, type ComponentType} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it} from 'vitest';

import {phoneAnswer, initialPhoneCountry} from '../../src/form-types/phone/PhoneInput';
import {nextAddressValue} from '../../src/form-types/address/Renderer';
import {addDays, dateTextToIso, isDayAllowed, maskDate, monthGrid} from '../../src/form-types/date/mask';
import {FIELD_ICONS} from '../../src/form-types/icons';
import {multipleChoiceAnswer, selectedValues} from '../../src/form-types/multiple_choice/answer';
import {nextNameValue} from '../../src/form-types/name/Renderer';
import {parseNumberText} from '../../src/form-types/number/parse';
import {nextPictureSelection} from '../../src/form-types/picture_choice/Renderer';
import {FIELD_RENDERERS, respondentRenderers} from '../../src/form-types/renderers';
import {LETTERS, OTHER_VALUE, toggleValue} from '../../src/form-types/_respondent/constants';
import {faceFor, ratingStepName, ratingSteps} from '../../src/form-types/_respondent/scales';
import {CONDITION_VALUE_INPUTS, FIELD_SETTINGS, settingsEditors} from '../../src/form-types/settings';
import {allowedHours, allowedMinutes, stepMinutes, timeAnswer, to24} from '../../src/form-types/time/options';
import {OTHER_OPTION_ID} from '../../src/lib/intelform/form/base';
import {FIELD_TYPES, type FieldType} from '../../src/lib/intelform/form/field-types';
import {SYSTEM_LABELS} from '../../src/lib/intelform/form/labels';
import {createField} from '../../src/portal/intelform/builder/ops';
import {CARD_BY_KIND} from '../../src/portal/intelform/responses/cards';
import {ICON_NAMES} from '../../src/portal/ui';
import type {FieldRendererProps} from '../../src/respondent/types';

/** Field types whose operators take a value in the logic editor. */
const VALUE_TYPES: FieldType[] = [
  'email',
  'name',
  'phone',
  'address',
  'country',
  'short_text',
  'long_text',
  'number',
  'url',
  'date',
  'time',
  'single_choice',
  'multiple_choice',
  'dropdown',
  'picture_choice',
  'rating',
  'nps',
];

describe('form-types registries', () => {
  it('cover all 21 field types', () => {
    expect(FIELD_TYPES).toHaveLength(21);
    for (const t of FIELD_TYPES) {
      expect(FIELD_RENDERERS[t], `renderer for ${t}`).toBeTypeOf('function');
      expect(FIELD_SETTINGS[t], `settings for ${t}`).toBeTypeOf('function');
      expect(ICON_NAMES).toContain(FIELD_ICONS[t]);
    }
  });

  it('have a summary card for every kind of summary data', () => {
    expect(Object.keys(CARD_BY_KIND).sort()).toEqual(['choice', 'count', 'latest', 'nps', 'number', 'rating']);
    for (const card of Object.values(CARD_BY_KIND)) expect(card).toBeTypeOf('function');
  });

  it('have a logic value input exactly for the types whose operators take a value', () => {
    expect(Object.keys(CONDITION_VALUE_INPUTS).sort()).toEqual([...VALUE_TYPES].sort());
  });

  it('export the aliases the contract names', () => {
    expect(respondentRenderers).toBe(FIELD_RENDERERS);
    expect(settingsEditors).toBe(FIELD_SETTINGS);
  });
});

describe('respondent renderers (server markup)', () => {
  const render = (type: FieldType, value?: unknown, extra: Partial<FieldRendererProps> = {}) => {
    const field = createField(type);
    field.label = 'Question';
    const Renderer = FIELD_RENDERERS[type] as ComponentType<FieldRendererProps>;
    return renderToStaticMarkup(
      createElement(Renderer, {
        field,
        value,
        onChange: () => {},
        labels: SYSTEM_LABELS,
        inputId: 'if-q',
        invalid: false,
        legend: 'Question',
        large: false,
        preview: false,
        ...extra,
      })
    );
  };

  it('renders every type without a dashboard class or inline style', () => {
    for (const t of FIELD_TYPES) {
      const html = render(t);
      expect(html, t).not.toMatch(/style="/);
      expect(html, t).not.toMatch(/class="[^"]*\b(btn|card-panel|field-hint)\b/);
      if (t !== 'section_break') expect(html.length, t).toBeGreaterThan(0);
    }
  });

  it('gives input types the question input id', () => {
    for (const t of ['short_text', 'email', 'url', 'number', 'long_text', 'date', 'phone'] as FieldType[]) {
      expect(render(t), t).toContain('id="if-q"');
    }
  });

  it('marks the selected choice tile', () => {
    const field = createField('single_choice');
    const first = (field.props as {options: {id: string}[]}).options[0]!.id;
    const Renderer = FIELD_RENDERERS.single_choice as ComponentType<FieldRendererProps>;
    const html = renderToStaticMarkup(
      createElement(Renderer, {
        field,
        value: {option: first},
        onChange: () => {},
        labels: SYSTEM_LABELS,
        inputId: 'if-q',
        invalid: false,
        legend: 'Q',
        large: false,
        preview: false,
      })
    );
    expect(html).toContain('data-state="checked"');
    expect(html).toContain('aria-keyshortcuts="A"');
  });

  it('draws 11 NPS radios and the rating steps', () => {
    expect(render('nps').match(/type="radio"/g)).toHaveLength(11);
    const rating = createField('rating');
    expect(render('rating').match(/type="radio"/g)).toHaveLength((rating.props as {scale: number}).scale);
  });

  it('shows the error with a large legend class in one-at-a-time', () => {
    const html = render('yes_no', true, {error: 'Required', large: true});
    expect(html).toContain('rf-question-xl');
    expect(html).toContain('role="alert"');
  });
});

describe('choice helpers', () => {
  it('toggles checkbox values, ticked last', () => {
    expect(toggleValue(['a', 'b'], 'a', true)).toEqual(['b', 'a']);
    expect(toggleValue(['a', 'b'], 'a', false)).toEqual(['b']);
    expect(LETTERS[0]).toBe('A');
  });

  it('builds multiple-choice answers with the Other text', () => {
    expect(multipleChoiceAnswer([], '')).toBeUndefined();
    expect(multipleChoiceAnswer(['o1', OTHER_VALUE], 'Mine')).toEqual([{option: 'o1'}, {option: OTHER_OPTION_ID, other: 'Mine'}]);
    expect(selectedValues([{option: 'o1'}, {option: OTHER_OPTION_ID, other: 'x'}])).toEqual({selected: ['o1', OTHER_VALUE], otherText: 'x'});
    expect(selectedValues(null)).toEqual({selected: [], otherText: ''});
  });

  it('selects pictures singly or several', () => {
    expect(nextPictureSelection(new Set(['a']), 'b', true, false)).toEqual(['b']);
    expect(nextPictureSelection(new Set(['a']), 'b', true, true)).toEqual(['a', 'b']);
    expect(nextPictureSelection(new Set(['a', 'b']), 'a', false, true)).toEqual(['b']);
    expect(nextPictureSelection(new Set(['a']), 'a', false, false)).toEqual([]);
  });

  it('names rating steps and picks faces', () => {
    expect(ratingSteps(1)).toBe(3);
    expect(ratingSteps(12)).toBe(10);
    expect(ratingStepName(1, 5, 'stars')).toBe('1 star');
    expect(ratingStepName(3, 5, 'numbers')).toBe('3 of 5');
    expect(ratingStepName(5, 5, 'emoji')).toBe('5 of 5, Very happy');
    expect(faceFor(1, 3).label).toBe('Very unhappy');
    expect(faceFor(2, 3).label).toBe('Neutral');
  });
});

describe('contact parts', () => {
  it('clears a split name when both parts are empty', () => {
    expect(nextNameValue({}, 'first', 'Ada')).toEqual({first: 'Ada', last: ''});
    expect(nextNameValue({first: 'A', last: ''}, 'first', '')).toBeUndefined();
  });

  it('clears an address when every line is blank', () => {
    expect(nextAddressValue({}, 'city', 'Oslo')).toEqual({city: 'Oslo'});
    expect(nextAddressValue({city: 'Oslo'}, 'city', '  ')).toBeUndefined();
  });

  it('stores phone numbers as E.164 when possible', () => {
    expect(phoneAnswer('', 'US')).toBeUndefined();
    expect(phoneAnswer('(650) 253-0000', 'US')).toBe('+16502530000');
    expect(phoneAnswer('12', 'US')).toBe('12');
    expect(initialPhoneCountry('+16502530000', null, 'DE')).toBe('US');
    expect(initialPhoneCountry(undefined, 'DE', 'FR')).toBe('DE');
    expect(initialPhoneCountry(undefined, null, 'FR')).toBe('FR');
    expect(initialPhoneCountry(undefined, null, 'ZZ')).toBe('US');
  });
});

describe('number text', () => {
  it('parses numbers as typed, with a comma or a point', () => {
    expect(parseNumberText(' ')).toEqual({kind: 'empty'});
    expect(parseNumberText('12')).toEqual({kind: 'number', value: 12});
    expect(parseNumberText('-1,5')).toEqual({kind: 'number', value: -1.5});
    expect(parseNumberText('.5')).toEqual({kind: 'number', value: 0.5});
    expect(parseNumberText('1e3')).toEqual({kind: 'invalid'});
    expect(parseNumberText('abc')).toEqual({kind: 'invalid'});
  });
});

describe('date text', () => {
  it('masks typed digits into the display format', () => {
    expect(maskDate('3112', 'DD/MM/YYYY')).toBe('31/12');
    expect(maskDate('31122024999', 'DD/MM/YYYY')).toBe('31/12/2024');
    expect(maskDate('20241231', 'YYYY-MM-DD')).toBe('2024-12-31');
    expect(maskDate('12a31', 'MM/DD/YYYY')).toBe('12/31');
    expect(maskDate('01022024', 'DD.MM.YYYY')).toBe('01.02.2024');
  });

  it('reads complete, real dates only', () => {
    expect(dateTextToIso('31/12/2024', 'DD/MM/YYYY')).toBe('2024-12-31');
    expect(dateTextToIso('12/31/2024', 'MM/DD/YYYY')).toBe('2024-12-31');
    expect(dateTextToIso('31/02/2024', 'DD/MM/YYYY')).toBeNull();
    expect(dateTextToIso('31/12', 'DD/MM/YYYY')).toBeNull();
  });

  it('limits calendar days', () => {
    const limits = {minDate: '2024-01-10', maxDate: '2024-01-20', disablePast: false, disableFuture: false};
    expect(isDayAllowed('2024-01-09', limits, '2024-01-15')).toBe(false);
    expect(isDayAllowed('2024-01-10', limits, '2024-01-15')).toBe(true);
    expect(isDayAllowed('2024-01-21', limits, '2024-01-15')).toBe(false);
    const past = {minDate: null, maxDate: null, disablePast: true, disableFuture: false};
    expect(isDayAllowed('2024-01-14', past, '2024-01-15')).toBe(false);
    expect(isDayAllowed('2024-01-15', past, '2024-01-15')).toBe(true);
  });

  it('lays out a month Monday first', () => {
    // February 2024 starts on a Thursday and has 29 days.
    const weeks = monthGrid(2024, 1);
    expect(weeks[0]).toEqual([null, null, null, '2024-02-01', '2024-02-02', '2024-02-03', '2024-02-04']);
    expect(weeks.flat().filter(Boolean)).toHaveLength(29);
    expect(weeks.every(w => w.length === 7)).toBe(true);
    expect(addDays('2024-02-28', 2)).toBe('2024-03-01');
  });
});

describe('time choices', () => {
  it('builds minutes from the step', () => {
    expect(stepMinutes(15)).toEqual([0, 15, 30, 45]);
    expect(stepMinutes(60)).toEqual([0]);
    expect(allowedMinutes(15, 3)).toEqual([0, 15, 30, 45]);
    // 7-minute step: only times on the step from 00:00.
    expect(allowedMinutes(7, 0)).toEqual([0, 7, 14, 21, 28, 35, 42, 49, 56]);
    expect(allowedMinutes(7, 1)).toEqual([]);
    expect(allowedHours(15)).toHaveLength(24);
    expect(allowedHours(7)).toContain(0);
    expect(allowedHours(7)).not.toContain(1);
  });

  it('answers HH:mm only with both parts', () => {
    expect(timeAnswer(null, null)).toEqual({value: undefined, invalid: null});
    expect(timeAnswer(9, null)).toEqual({value: undefined, invalid: 'invalidTime'});
    expect(timeAnswer(9, 5)).toEqual({value: '09:05', invalid: null});
    expect(to24(12, 'AM')).toBe(0);
    expect(to24(12, 'PM')).toBe(12);
    expect(to24(3, 'PM')).toBe(15);
  });
});

describe('new questions get a starter title', () => {
  it('every type starts with a non-empty, editable title', async () => {
    const {FIELD_TYPES} = await import('../../src/lib/intelform/form/field-types');
    for (const t of FIELD_TYPES) expect(createField(t).label.trim(), t).not.toBe('');
    expect(createField('email').label).toBe('What’s your email?');
    expect(createField('nps').label).toBe('How likely are you to recommend us to a friend?');
  });
});

describe('starter titles follow the type until edited', () => {
  it('swaps an unedited starter title on a type change, keeps an edited one', async () => {
    const {changeType} = await import('../../src/portal/intelform/builder/ops');
    const email = createField('email');
    const def = {layout: 'all_at_once', startScreen: {enabled: false, title: '', button: 'Start'}, fields: [email], endScreen: {title: 'Thanks!', message: ''}} as never;
    changeType(def, email.id, 'phone');
    expect((def as {fields: {label: string}[]}).fields[0]!.label).toBe('What’s your phone number?');
    (def as {fields: {label: string}[]}).fields[0]!.label = 'Best number to call?';
    changeType(def, email.id, 'short_text');
    expect((def as {fields: {label: string}[]}).fields[0]!.label).toBe('Best number to call?');
  });
});
