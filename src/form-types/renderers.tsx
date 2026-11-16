import {type ComponentType, createElement, lazy, Suspense} from 'react';

import type {FieldType} from '../lib/intelform/form/field-types';
import type {FieldRendererProps} from '../respondent/types';
import ConsentRenderer from './consent/Renderer';
import DateRenderer from './date/Renderer';
import DropdownRenderer from './dropdown/Renderer';
import EmailRenderer from './email/Renderer';
import LongTextRenderer from './long_text/Renderer';
import MultipleChoiceRenderer from './multiple_choice/Renderer';
import NameRenderer from './name/Renderer';
import NpsRenderer from './nps/Renderer';
import NumberRenderer from './number/Renderer';
import PhoneRenderer from './phone/Renderer';
import RatingRenderer from './rating/Renderer';
import SectionBreakRenderer from './section_break/Renderer';
import ShortTextRenderer from './short_text/Renderer';
import SignatureRenderer from './signature/Renderer';
import SingleChoiceRenderer from './single_choice/Renderer';
import TimeRenderer from './time/Renderer';
import UrlRenderer from './url/Renderer';
import YesNoRenderer from './yes_no/Renderer';
import type {RendererRegistry} from './types';
import './respondent.css';

export type {FieldRendererProps} from '../respondent/types';
export {isGroupField} from '../respondent/types';

/**
 * Field types with heavy code (the full country list behind country and address, the picture
 * tiles) are fetched only when a form uses them: a public form downloads the inputs it shows.
 */
function onDemand<P extends object>(load: () => Promise<{default: ComponentType<P>}>): ComponentType<P> {
  const Lazy = lazy(load);
  function OnDemand(props: P) {
    return createElement(Suspense, {fallback: createElement('div', {className: 'rf-field-loading', 'aria-busy': true})}, createElement(Lazy as ComponentType<P>, props));
  }
  return OnDemand;
}

const AddressRenderer = onDemand(() => import('./address/Renderer'));
const CountryRenderer = onDemand(() => import('./country/Renderer'));
const PictureChoiceRenderer = onDemand(() => import('./picture_choice/Renderer'));

/**
 * The respondent input of each field type. Plain elements with the respondent's `rf-*` and the
 * field types' `ft-*` classes (src/form-types/respondent.css), no dashboard kit, so the public
 * form stays light. Heavy inputs (phone, the date calendar, signature) load their libraries on
 * demand inside their own renderer.
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
} satisfies {[K in FieldType]: ComponentType<FieldRendererProps<K>>} as unknown as RendererRegistry;

/** Alias of FIELD_RENDERERS. */
export const respondentRenderers: RendererRegistry = FIELD_RENDERERS;
