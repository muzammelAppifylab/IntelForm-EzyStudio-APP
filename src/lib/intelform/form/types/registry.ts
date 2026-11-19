import type * as z from 'zod/mini'
import type { FieldType } from '../field-types'
import { consent, section_break, signature } from './advanced'
import { date, long_text, number, short_text, time, url } from './basic'
import { dropdown, multiple_choice, picture_choice, single_choice, yes_no } from './choice'
import type { FieldTypeCore } from './common'
import { address, country, email, name, phone } from './contact'
import { nps, rating } from './rating'
import { coreRegistry, registerFieldTypes } from './registry-store'

export type { AnswerContext, AnswerValidators, ChoiceAnswer, CoreField, FieldTypeCore } from './common'
export { configureValidators, isChoiceAnswer } from './common'
export { OTHER_OPTION_ID } from '../base'
export { COUNTRY_CODES, countryName, isCountryCode } from './countries'
export { ADDRESS_LINES, E164_RE, EMAIL_RE, type AddressAnswer, type AddressLine, type NameAnswer } from './contact'
export { DATE_FORMATS, formatDate, formatTime, isIsoDate, isTime, type DateFormat } from './basic'
export { npsCategory } from './rating'
export {
  SIGNATURE_DATA_URL_MAX,
  isSignatureDataUrl,
  signatureBytes,
  type ConsentAnswer,
  type SignatureAnswer,
} from './advanced'

/** Each type with its exact props schema. Use for typed access: `typedRegistry.rating.props`. */
export const typedRegistry = {
  email,
  name,
  phone,
  address,
  country,
  short_text,
  long_text,
  number,
  url,
  date,
  time,
  single_choice,
  multiple_choice,
  dropdown,
  yes_no,
  picture_choice,
  rating,
  nps,
  signature,
  consent,
  section_break,
} satisfies { [K in FieldType]: FieldTypeCore<K, z.ZodMiniType> }

/** The pure (server-safe) half of every field type, keyed by type: all of them, once this file loads. */
registerFieldTypes(typedRegistry)
export { coreRegistry }

export type TypedRegistry = typeof typedRegistry
/** Props of one field type, e.g. PropsOf<'rating'>. */
export type PropsOf<T extends FieldType> = z.output<TypedRegistry[T]['props']>
