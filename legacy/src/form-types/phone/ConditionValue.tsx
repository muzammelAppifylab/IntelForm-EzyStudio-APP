import { isE164 } from '@shared/form/types/contact'
import type { ConditionValueProps } from '@/builder/type-ui'
import { TextValue } from '@/builder/condition-inputs'

/**
 * Answers are stored with their country code (+16502530000), so "is" and "is not" need the full
 * number to ever match; "contains" can take any run of digits.
 */
export default function PhoneConditionValue(props: ConditionValueProps<'phone'>) {
  const exact = props.op === 'is' || props.op === 'is_not'
  const filled = typeof props.value === 'string' && props.value.trim() !== ''
  return (
    <TextValue
      {...(props as ConditionValueProps)}
      inputMode="tel"
      placeholder={exact ? '+1 650 253 0000' : 'Digits, e.g. 650'}
      invalid={exact && filled && !isE164(props.value)}
    />
  )
}
