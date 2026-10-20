import type { ComponentType } from 'react'
import type { FieldType } from '@shared/form/field-types'
import type { FieldRendererProps } from '@/respondent/types'
import AddressRenderer from './address/Renderer'
import ConsentRenderer from './consent/Renderer'
import CountryRenderer from './country/Renderer'
import DateRenderer from './date/Renderer'
import DropdownRenderer from './dropdown/Renderer'
import EmailRenderer from './email/Renderer'
import LongTextRenderer from './long_text/Renderer'
import MultipleChoiceRenderer from './multiple_choice/Renderer'
import NameRenderer from './name/Renderer'
import NpsRenderer from './nps/Renderer'
import NumberRenderer from './number/Renderer'
import PhoneRenderer from './phone/Renderer'
import PictureChoiceRenderer from './picture_choice/Renderer'
import RatingRenderer from './rating/Renderer'
import SectionBreakRenderer from './section_break/Renderer'
import ShortTextRenderer from './short_text/Renderer'
import SignatureRenderer from './signature/Renderer'
import SingleChoiceRenderer from './single_choice/Renderer'
import TimeRenderer from './time/Renderer'
import UrlRenderer from './url/Renderer'
import YesNoRenderer from './yes_no/Renderer'

export type { FieldRendererProps } from '@/respondent/types'
export { isGroupField } from '@/respondent/types'

/**
 * Respondent input per field type (Agent E). Heavy inputs (phone, date calendar, signature)
 * load their libraries on demand inside their own renderer.
 */
export const FIELD_RENDERERS = {
  email: EmailRenderer,
  name: NameRenderer,
  phone: PhoneRenderer,
  address: AddressRenderer,
  country: CountryRenderer,
  short_text: ShortTextRenderer,
  long_text: LongTextRenderer,
  number: NumberRenderer,
  url: UrlRenderer,
  date: DateRenderer,
  time: TimeRenderer,
  single_choice: SingleChoiceRenderer,
  multiple_choice: MultipleChoiceRenderer,
  dropdown: DropdownRenderer,
  yes_no: YesNoRenderer,
  picture_choice: PictureChoiceRenderer,
  rating: RatingRenderer,
  nps: NpsRenderer,
  signature: SignatureRenderer,
  consent: ConsentRenderer,
  section_break: SectionBreakRenderer,
} as unknown as Record<FieldType, ComponentType<FieldRendererProps>>
