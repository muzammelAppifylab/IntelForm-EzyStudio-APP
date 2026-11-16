import type { FieldType } from '@shared/form/field-types'
import type { ConditionValueComponent, FieldSettingsComponent } from '@/builder/type-ui'
import EmailSettings from './email/Settings'
import NameSettings from './name/Settings'
import PhoneSettings from './phone/Settings'
import AddressSettings from './address/Settings'
import CountrySettings from './country/Settings'
import ShortTextSettings from './short_text/Settings'
import LongTextSettings from './long_text/Settings'
import NumberSettings from './number/Settings'
import UrlSettings from './url/Settings'
import DateSettings from './date/Settings'
import TimeSettings from './time/Settings'
import SingleChoiceSettings from './single_choice/Settings'
import MultipleChoiceSettings from './multiple_choice/Settings'
import DropdownSettings from './dropdown/Settings'
import YesNoSettings from './yes_no/Settings'
import PictureChoiceSettings from './picture_choice/Settings'
import RatingSettings from './rating/Settings'
import NpsSettings from './nps/Settings'
import SignatureSettings from './signature/Settings'
import ConsentSettings from './consent/Settings'
import SectionBreakSettings from './section_break/Settings'
import EmailConditionValue from './email/ConditionValue'
import NameConditionValue from './name/ConditionValue'
import PhoneConditionValue from './phone/ConditionValue'
import AddressConditionValue from './address/ConditionValue'
import ShortTextConditionValue from './short_text/ConditionValue'
import LongTextConditionValue from './long_text/ConditionValue'
import UrlConditionValue from './url/ConditionValue'
import NumberConditionValue from './number/ConditionValue'
import RatingConditionValue from './rating/ConditionValue'
import NpsConditionValue from './nps/ConditionValue'
import DateConditionValue from './date/ConditionValue'
import TimeConditionValue from './time/ConditionValue'
import SingleChoiceConditionValue from './single_choice/ConditionValue'
import MultipleChoiceConditionValue from './multiple_choice/ConditionValue'
import DropdownConditionValue from './dropdown/ConditionValue'
import PictureChoiceConditionValue from './picture_choice/ConditionValue'
import CountryConditionValue from './country/ConditionValue'

/**
 * The builder half of the field-type registry (Agent F): each type's settings panel and its
 * logic value input. Types whose operators take no value (Yes / No, Consent, Signature) and
 * Section break (no answer) have no value input.
 */
export const FIELD_SETTINGS: { [K in FieldType]: FieldSettingsComponent<K> } = {
  email: EmailSettings,
  name: NameSettings,
  phone: PhoneSettings,
  address: AddressSettings,
  country: CountrySettings,
  short_text: ShortTextSettings,
  long_text: LongTextSettings,
  number: NumberSettings,
  url: UrlSettings,
  date: DateSettings,
  time: TimeSettings,
  single_choice: SingleChoiceSettings,
  multiple_choice: MultipleChoiceSettings,
  dropdown: DropdownSettings,
  yes_no: YesNoSettings,
  picture_choice: PictureChoiceSettings,
  rating: RatingSettings,
  nps: NpsSettings,
  signature: SignatureSettings,
  consent: ConsentSettings,
  section_break: SectionBreakSettings,
}

export const CONDITION_VALUE_INPUTS: { [K in FieldType]?: ConditionValueComponent<K> } = {
  email: EmailConditionValue,
  name: NameConditionValue,
  phone: PhoneConditionValue,
  address: AddressConditionValue,
  short_text: ShortTextConditionValue,
  long_text: LongTextConditionValue,
  url: UrlConditionValue,
  number: NumberConditionValue,
  rating: RatingConditionValue,
  nps: NpsConditionValue,
  date: DateConditionValue,
  time: TimeConditionValue,
  single_choice: SingleChoiceConditionValue,
  multiple_choice: MultipleChoiceConditionValue,
  dropdown: DropdownConditionValue,
  picture_choice: PictureChoiceConditionValue,
  country: CountryConditionValue,
}
