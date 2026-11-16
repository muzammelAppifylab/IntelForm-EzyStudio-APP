import {describe, expect, it} from 'vitest';

import {blankDefinition, newField, type FormDefinition} from '../../src/lib/intelform/form/definition';
import {coreRegistry} from '../../src/lib/intelform/form/types/registry';
import {
  conditionProblem,
  endButtonFrom,
  endButtonUrlError,
  LAYOUT_HELP,
  logicSources,
  MAX_CONDITIONS,
  needsValue,
  newCondition,
  operatorsFor,
  parseNumberText,
  questionNumber,
  ruleIssues,
  ruleSubject,
  withOperator,
  withValue,
} from '../../src/portal/intelform/builder/panel/model';

function sample(): FormDefinition {
  const def = blankDefinition();
  def.fields = [
    newField('short_text', {id: 'f_name1', label: 'Name'}),
    newField('section_break', {id: 'f_sect1', label: 'Page 2'}),
    newField('number', {id: 'f_age01', label: 'Age'}),
    newField('long_text', {id: 'f_more1', label: 'Tell us more'}),
  ];
  return def;
}

describe('builder panel model', () => {
  it('numbers questions without counting section breaks', () => {
    const def = sample();
    expect(questionNumber(def, 0)).toBe(1);
    expect(questionNumber(def, 2)).toBe(2);
    expect(questionNumber(def, 3)).toBe(3);
  });

  it('calls a section break a page', () => {
    expect(ruleSubject({type: 'section_break'})).toBe('page');
    expect(ruleSubject({type: 'email'})).toBe('question');
  });

  it('offers only earlier, answer-storing questions as rule sources', () => {
    const def = sample();
    expect(logicSources(def, 0)).toEqual([]);
    expect(logicSources(def, 3).map(f => f.id)).toEqual(['f_name1', 'f_age01']);
  });

  it('starts a condition with the source type’s first operator', () => {
    const src = sample().fields[2]!;
    expect(newCondition(src)).toEqual({field: 'f_age01', op: coreRegistry.number.operators[0]});
    expect(operatorsFor(src)).toBe(coreRegistry.number.operators);
    expect(operatorsFor(undefined)).toEqual([]);
  });

  it('keeps the value when switching between operators that take one', () => {
    expect(withOperator({field: 'f_a', op: 'contains', value: 'x'}, 'is')).toEqual({field: 'f_a', op: 'is', value: 'x'});
    expect(withOperator({field: 'f_a', op: 'contains', value: 'x'}, 'is_empty')).toEqual({field: 'f_a', op: 'is_empty'});
    expect(withOperator({field: 'f_a', op: 'is_empty'}, 'is')).toEqual({field: 'f_a', op: 'is'});
    expect(needsValue('is_yes')).toBe(false);
    expect(needsValue('gt')).toBe(true);
  });

  it('drops empty values instead of storing ""', () => {
    expect(withValue({field: 'f_a', op: 'is', value: 'x'}, '')).toEqual({field: 'f_a', op: 'is'});
    expect(withValue({field: 'f_a', op: 'is'}, undefined)).toEqual({field: 'f_a', op: 'is'});
    expect(withValue({field: 'f_a', op: 'gt'}, 3)).toEqual({field: 'f_a', op: 'gt', value: 3});
  });

  it('tells a moved-below source from a deleted one', () => {
    const def = sample();
    const sources = logicSources(def, 2);
    expect(conditionProblem(def, sources, {field: 'f_name1', op: 'is'})).toBeNull();
    expect(conditionProblem(def, sources, {field: 'f_more1', op: 'is'})).toEqual({kind: 'below', field: def.fields[3]});
    expect(conditionProblem(def, sources, {field: 'f_gone1', op: 'is'})).toEqual({kind: 'deleted'});
  });

  it('lists only the selected field’s per-condition issues', () => {
    const def = sample();
    def.fields[3]!.logic = {action: 'show', match: 'all', conditions: [{field: 'f_gone1', op: 'is_not_empty'}]};
    const issues = ruleIssues(def, 'f_more1');
    expect(issues).toHaveLength(1);
    expect(issues[0]!.conditionIndex).toBe(0);
    expect(ruleIssues(def, 'f_name1')).toEqual([]);
  });

  it('builds the end-screen button only from a label and a safe link', () => {
    expect(endButtonFrom(' Home ', ' https://example.com ', false)).toEqual({label: 'Home', url: 'https://example.com'});
    expect(endButtonFrom('x'.repeat(60), 'https://example.com', false)!.label).toHaveLength(40);
    expect(endButtonFrom('Home', 'javascript:alert(1)', false)).toBeUndefined();
    expect(endButtonFrom('Home', 'javascript:alert(1)', true)).toBeNull();
    expect(endButtonFrom('', 'https://example.com', true)).toBeNull();
    expect(endButtonUrlError('')).toBeNull();
    expect(endButtonUrlError('example')).toMatch(/https/);
    expect(endButtonUrlError('https://example.com')).toBeNull();
  });

  it('parses number boxes where empty means none', () => {
    expect(parseNumberText('')).toEqual({value: null, error: null});
    expect(parseNumberText('5', {min: 1, max: 120})).toEqual({value: 5, error: null});
    expect(parseNumberText('0', {min: 1})).toEqual({value: undefined, error: 'Enter 1 or more'});
    expect(parseNumberText('121', {max: 120})).toEqual({value: undefined, error: 'Enter 120 or less'});
    expect(parseNumberText('1.5')).toEqual({value: undefined, error: 'Enter a whole number'});
    expect(parseNumberText('1.5', {integer: false})).toEqual({value: 1.5, error: null});
    expect(parseNumberText('abc', {integer: false})).toEqual({value: undefined, error: 'Enter a number'});
  });

  it('has help for every layout and a condition cap', () => {
    expect(Object.keys(LAYOUT_HELP).sort()).toEqual(['all_at_once', 'one_at_a_time', 'section_by_section']);
    expect(MAX_CONDITIONS).toBe(20);
  });
});
