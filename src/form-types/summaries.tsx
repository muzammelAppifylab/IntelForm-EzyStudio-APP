import AddressSummary from './address/SummaryCard';
import ConsentSummary from './consent/SummaryCard';
import CountrySummary from './country/SummaryCard';
import DateSummary from './date/SummaryCard';
import DropdownSummary from './dropdown/SummaryCard';
import EmailSummary from './email/SummaryCard';
import LongTextSummary from './long_text/SummaryCard';
import MultipleChoiceSummary from './multiple_choice/SummaryCard';
import NameSummary from './name/SummaryCard';
import NpsSummary from './nps/SummaryCard';
import NumberSummary from './number/SummaryCard';
import PhoneSummary from './phone/SummaryCard';
import PictureChoiceSummary from './picture_choice/SummaryCard';
import RatingSummary from './rating/SummaryCard';
import ShortTextSummary from './short_text/SummaryCard';
import SignatureSummary from './signature/SummaryCard';
import SingleChoiceSummary from './single_choice/SummaryCard';
import TimeSummary from './time/SummaryCard';
import type {SummaryRegistry} from './types';
import UrlSummary from './url/SummaryCard';
import YesNoSummary from './yes_no/SummaryCard';

export type {SummaryCardProps} from './types';

/**
 * Responses → Summary: the card for each field type (kit-based bodies in
 * src/portal/intelform/responses/cards.tsx). Section breaks store nothing, so they have no card.
 */
export const SUMMARY_CARDS: SummaryRegistry = {
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
};

/** Alias of SUMMARY_CARDS. */
export const summaryRenderers = SUMMARY_CARDS;
