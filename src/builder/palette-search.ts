import { FIELD_GROUP_LABEL, FIELD_TYPE_META, type FieldType } from '@shared/form/field-types'

/** Extra words people search for. */
export const FIELD_KEYWORDS: Partial<Record<FieldType, string>> = {
  short_text: 'text input answer',
  long_text: 'paragraph textarea comments feedback',
  single_choice: 'radio options multiple choice one',
  multiple_choice: 'checkbox checkboxes options several',
  dropdown: 'select list',
  yes_no: 'boolean toggle',
  picture_choice: 'image photo',
  rating: 'stars score',
  nps: 'net promoter score recommend 0 10',
  consent: 'terms privacy gdpr agree checkbox',
  section_break: 'page divider heading step',
  phone: 'telephone mobile',
  url: 'link website',
  number: 'amount quantity',
}

export function matchesType(type: FieldType, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return `${FIELD_TYPE_META[type].label} ${FIELD_GROUP_LABEL[FIELD_TYPE_META[type].group]} ${FIELD_KEYWORDS[type] ?? ''}`.toLowerCase().includes(q)
}

