import {OTHER_OPTION_ID} from '../../lib/intelform/form/base';
import {OTHER_VALUE} from '../_respondent/constants';

export interface ChoiceAnswer {
  option: string;
  other?: string;
}

/** The answer for a set of ticked values ("Other" carries its text); undefined when none. */
export function multipleChoiceAnswer(values: readonly string[], otherText: string): ChoiceAnswer[] | undefined {
  const next = values.map(v => (v === OTHER_VALUE ? {option: OTHER_OPTION_ID, other: otherText} : {option: v}));
  return next.length ? next : undefined;
}

/** The ticked tile values and the "Other" text of a stored answer. */
export function selectedValues(value: unknown): {selected: string[]; otherText: string} {
  const answers = (Array.isArray(value) ? value : []) as ChoiceAnswer[];
  return {
    selected: answers.map(a => (a.option === OTHER_OPTION_ID ? OTHER_VALUE : a.option)),
    otherText: answers.find(a => a.option === OTHER_OPTION_ID)?.other ?? '',
  };
}
