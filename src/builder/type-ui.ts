import type { ComponentType } from 'react'
import type { Condition, ConditionOp, FieldOf, PropsOf } from '@shared/form/definition'
import type { FieldType } from '@shared/form/field-types'

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
