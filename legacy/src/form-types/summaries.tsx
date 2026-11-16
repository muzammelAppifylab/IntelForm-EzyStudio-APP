import type { ComponentType } from 'react'
import type { FieldType } from '@shared/form/field-types'
import type { SummaryCardProps } from '@/pages/builder/responses/cards'
import EmailSummary from './email/SummaryCard'
import NameSummary from './name/SummaryCard'
import PhoneSummary from './phone/SummaryCard'
import AddressSummary from './address/SummaryCard'
import CountrySummary from './country/SummaryCard'
import ShortTextSummary from './short_text/SummaryCard'
import LongTextSummary from './long_text/SummaryCard'
import NumberSummary from './number/SummaryCard'
import UrlSummary from './url/SummaryCard'
import DateSummary from './date/SummaryCard'
import TimeSummary from './time/SummaryCard'
import SingleChoiceSummary from './single_choice/SummaryCard'
import MultipleChoiceSummary from './multiple_choice/SummaryCard'
import DropdownSummary from './dropdown/SummaryCard'
import YesNoSummary from './yes_no/SummaryCard'
import PictureChoiceSummary from './picture_choice/SummaryCard'
import RatingSummary from './rating/SummaryCard'
import NpsSummary from './nps/SummaryCard'
import SignatureSummary from './signature/SummaryCard'
import ConsentSummary from './consent/SummaryCard'

export type { SummaryCardProps }

/**
 * Responses → Summary: the card for each field type (Agent G). Section breaks store nothing,
 * so they have no card.
 */
export const SUMMARY_CARDS: Record<FieldType, ComponentType<SummaryCardProps> | null> = {
  email: EmailSummary,
  name: NameSummary,
  phone: PhoneSummary,
  address: AddressSummary,
  country: CountrySummary,
  short_text: ShortTextSummary,
  long_text: LongTextSummary,
  number: NumberSummary,
  url: UrlSummary,
  date: DateSummary,
  time: TimeSummary,
  single_choice: SingleChoiceSummary,
  multiple_choice: MultipleChoiceSummary,
  dropdown: DropdownSummary,
  yes_no: YesNoSummary,
  picture_choice: PictureChoiceSummary,
  rating: RatingSummary,
  nps: NpsSummary,
  signature: SignatureSummary,
  consent: ConsentSummary,
  section_break: null,
}
