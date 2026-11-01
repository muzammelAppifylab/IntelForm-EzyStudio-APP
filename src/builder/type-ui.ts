import type { ComponentType } from 'react'
import type { Condition, ConditionOp, FieldOf, PropsOf } from '@shared/form/definition'
import { FIELD_TYPE_META, type FieldGroup, type FieldType } from '@shared/form/field-types'

/** Props of a field type's settings panel (src/form-types/<type>/Settings.tsx). */
export interface FieldSettingsProps<T extends FieldType = FieldType> {
  field: FieldOf<T>
  /** Merge into props. `key` coalesces typing into one undo step. */
  onChange(props: Partial<PropsOf<T>>, key?: string): void
  readOnly: boolean
}

/** Props of a logic value input (src/form-types/<type>/ConditionValue.tsx). */
export interface ConditionValueProps<T extends FieldType = FieldType> {
  field: FieldOf<T>
  op: ConditionOp
  value: Condition['value']
  onChange(value: Condition['value']): void
  /** Accessible name, e.g. "Value for condition 1". */
  label: string
  readOnly?: boolean
}

export type FieldSettingsComponent<T extends FieldType = FieldType> = ComponentType<FieldSettingsProps<T>>
export type ConditionValueComponent<T extends FieldType = FieldType> = ComponentType<ConditionValueProps<T>>

/** Soft tint per palette group, so a field type reads at a glance (contact, text, choice, rating...). */
export const GROUP_TINT: Record<FieldGroup, string> = {
  contact: 'bg-ochre-100 text-ochre-700 ring-1 ring-ochre-200 ring-inset dark:bg-ochre-900 dark:text-ochre-300 dark:ring-ochre-800',
  basic: 'bg-info-100 text-info-600 ring-1 ring-info-200 ring-inset dark:bg-info-900 dark:text-info-300 dark:ring-info-800',
  choice: 'bg-periwinkle-100 text-periwinkle-600 ring-1 ring-periwinkle-200 ring-inset dark:bg-periwinkle-900 dark:text-periwinkle-300 dark:ring-periwinkle-800',
  rating: 'bg-pine-100 text-pine-600 ring-1 ring-pine-200 ring-inset dark:bg-pine-900 dark:text-pine-300 dark:ring-pine-800',
  advanced: 'bg-persimmon-100 text-persimmon-700 ring-1 ring-persimmon-200 ring-inset dark:bg-persimmon-900 dark:text-persimmon-300 dark:ring-persimmon-800',
  layout: 'bg-paper-100 text-paper-700 ring-1 ring-paper-300 ring-inset dark:bg-paper-800 dark:text-paper-200 dark:ring-paper-700',
}

export const fieldTint = (type: FieldType) => GROUP_TINT[FIELD_TYPE_META[type].group]
