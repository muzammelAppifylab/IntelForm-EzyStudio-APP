import type {ComponentType} from 'react';

import type {Condition, ConditionOp, FieldOf, PropsOf} from '../../../lib/intelform/form/definition';
import {FIELD_TYPE_META, type FieldGroup, type FieldType} from '../../../lib/intelform/form/field-types';

/** Props of a field type's settings panel (src/form-types/<type>/Settings.tsx). */
export interface FieldSettingsProps<T extends FieldType = FieldType> {
  field: FieldOf<T>;
  /** Merge into props. `key` coalesces typing into one undo step. */
  onChange(props: Partial<PropsOf<T>>, key?: string): void;
  readOnly: boolean;
}

/** Props of a logic value input (src/form-types/<type>/ConditionValue.tsx). */
export interface ConditionValueProps<T extends FieldType = FieldType> {
  field: FieldOf<T>;
  op: ConditionOp;
  value: Condition['value'];
  onChange(value: Condition['value']): void;
  /** Accessible name, e.g. "Value for condition 1". */
  label: string;
  readOnly?: boolean;
}

export type FieldSettingsComponent<T extends FieldType = FieldType> = ComponentType<FieldSettingsProps<T>>;
export type ConditionValueComponent<T extends FieldType = FieldType> = ComponentType<ConditionValueProps<T>>;

/**
 * Soft tint per palette group, so a field type reads at a glance (contact, text, choice,
 * rating...). Plain classes: `.if-tint` plus one modifier per group, styled from tokens in the
 * builder's CSS (legacy used Tailwind palette utilities: ochre, info, periwinkle, pine,
 * persimmon, paper).
 */
export const GROUP_TINT: Record<FieldGroup, string> = {
  contact: 'if-tint if-tint-contact',
  basic: 'if-tint if-tint-basic',
  choice: 'if-tint if-tint-choice',
  rating: 'if-tint if-tint-rating',
  advanced: 'if-tint if-tint-advanced',
  layout: 'if-tint if-tint-layout',
};

export const fieldTint = (type: FieldType) => GROUP_TINT[FIELD_TYPE_META[type].group];
