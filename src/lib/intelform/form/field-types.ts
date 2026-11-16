/**
 * The 21 field types in their 6 palette groups (PRD "Field types").
 * This is the catalogue only. Each type's settings panel, renderer, validator and summary
 * card are added to the field-type registry in milestone 2, one folder per type.
 */

export const FIELD_GROUPS = ['contact', 'basic', 'choice', 'rating', 'advanced', 'layout'] as const
export type FieldGroup = (typeof FIELD_GROUPS)[number]

export const FIELD_GROUP_LABEL: Record<FieldGroup, string> = {
  contact: 'Contact',
  basic: 'Basic',
  choice: 'Choice',
  rating: 'Rating',
  advanced: 'Advanced',
  layout: 'Layout',
}

export const FIELD_TYPES = [
  'email',
  'name',
  'phone',
  'address',
  'country',
  'short_text',
  'long_text',
  'number',
  'url',
  'date',
  'time',
  'single_choice',
  'multiple_choice',
  'dropdown',
  'yes_no',
  'picture_choice',
  'rating',
  'nps',
  'signature',
  'consent',
  'section_break',
] as const
export type FieldType = (typeof FIELD_TYPES)[number]

export interface FieldTypeMeta {
  group: FieldGroup
  label: string
  /** Section break stores nothing; every other type stores an answer. */
  stores: boolean
  /** Text-like inputs get a placeholder setting. */
  hasPlaceholder: boolean
}

export const FIELD_TYPE_META: Record<FieldType, FieldTypeMeta> = {
  email: { group: 'contact', label: 'Email', stores: true, hasPlaceholder: true },
  name: { group: 'contact', label: 'Name', stores: true, hasPlaceholder: true },
  phone: { group: 'contact', label: 'Phone', stores: true, hasPlaceholder: true },
  address: { group: 'contact', label: 'Address', stores: true, hasPlaceholder: true },
  country: { group: 'contact', label: 'Country', stores: true, hasPlaceholder: true },
  short_text: { group: 'basic', label: 'Short text', stores: true, hasPlaceholder: true },
  long_text: { group: 'basic', label: 'Long text', stores: true, hasPlaceholder: true },
  number: { group: 'basic', label: 'Number', stores: true, hasPlaceholder: true },
  url: { group: 'basic', label: 'URL', stores: true, hasPlaceholder: true },
  date: { group: 'basic', label: 'Date', stores: true, hasPlaceholder: false },
  time: { group: 'basic', label: 'Time', stores: true, hasPlaceholder: false },
  single_choice: { group: 'choice', label: 'Single choice', stores: true, hasPlaceholder: false },
  multiple_choice: { group: 'choice', label: 'Multiple choice', stores: true, hasPlaceholder: false },
  dropdown: { group: 'choice', label: 'Dropdown', stores: true, hasPlaceholder: true },
  yes_no: { group: 'choice', label: 'Yes / No', stores: true, hasPlaceholder: false },
  picture_choice: { group: 'choice', label: 'Picture choice', stores: true, hasPlaceholder: false },
  rating: { group: 'rating', label: 'Rating', stores: true, hasPlaceholder: false },
  nps: { group: 'rating', label: 'NPS', stores: true, hasPlaceholder: false },
  signature: { group: 'advanced', label: 'Signature', stores: true, hasPlaceholder: false },
  consent: { group: 'advanced', label: 'Consent / Terms', stores: true, hasPlaceholder: false },
  section_break: { group: 'layout', label: 'Section break', stores: false, hasPlaceholder: false },
}
