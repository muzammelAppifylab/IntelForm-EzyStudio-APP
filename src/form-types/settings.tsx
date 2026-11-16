import type {FieldType} from '../lib/intelform/form/field-types';
import AddressConditionValue from './address/ConditionValue';
import AddressSettings from './address/Settings';
import ConsentSettings from './consent/Settings';
import CountryConditionValue from './country/ConditionValue';
import CountrySettings from './country/Settings';
import DateConditionValue from './date/ConditionValue';
import DateSettings from './date/Settings';
import DropdownConditionValue from './dropdown/ConditionValue';
import DropdownSettings from './dropdown/Settings';
import EmailConditionValue from './email/ConditionValue';
import EmailSettings from './email/Settings';
import LongTextConditionValue from './long_text/ConditionValue';
import LongTextSettings from './long_text/Settings';
import MultipleChoiceConditionValue from './multiple_choice/ConditionValue';
import MultipleChoiceSettings from './multiple_choice/Settings';
import NameConditionValue from './name/ConditionValue';
import NameSettings from './name/Settings';
import NpsConditionValue from './nps/ConditionValue';
import NpsSettings from './nps/Settings';
import NumberConditionValue from './number/ConditionValue';
import NumberSettings from './number/Settings';
import PhoneConditionValue from './phone/ConditionValue';
import PhoneSettings from './phone/Settings';
import PictureChoiceConditionValue from './picture_choice/ConditionValue';
import PictureChoiceSettings from './picture_choice/Settings';
import RatingConditionValue from './rating/ConditionValue';
import RatingSettings from './rating/Settings';
import SectionBreakSettings from './section_break/Settings';
import ShortTextConditionValue from './short_text/ConditionValue';
import ShortTextSettings from './short_text/Settings';
import SignatureSettings from './signature/Settings';
import SingleChoiceConditionValue from './single_choice/ConditionValue';
import SingleChoiceSettings from './single_choice/Settings';
import TimeConditionValue from './time/ConditionValue';
import TimeSettings from './time/Settings';
import type {ConditionValueRegistry, SettingsRegistry} from './types';
import UrlConditionValue from './url/ConditionValue';
import UrlSettings from './url/Settings';
import YesNoSettings from './yes_no/Settings';
import './portal.css';

/**
 * The builder half of the field-type registry: each type's settings panel (the kit plus the
 * builder's controls, src/portal/intelform/builder/controls.tsx) and its logic value input.
 * Types whose operators take no value (Yes / No, Consent, Signature) and Section break (no
 * answer) have no value input.
 */
export const FIELD_SETTINGS: SettingsRegistry = {
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
};

export const CONDITION_VALUE_INPUTS: ConditionValueRegistry = {
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
};

/** Types that have a logic value input (the rest take no value or store no answer). */
export const TYPES_WITH_CONDITION_VALUE = Object.keys(CONDITION_VALUE_INPUTS) as FieldType[];

/** Aliases. */
export const settingsEditors = FIELD_SETTINGS;
export const conditionValueInputs = CONDITION_VALUE_INPUTS;
