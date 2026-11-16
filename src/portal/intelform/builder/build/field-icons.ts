import type {FieldType} from '../../../../lib/intelform/form/field-types';
import type {IconName} from '../../../ui';

/**
 * One fixed icon per field type (legacy src/form-types/icons.ts, which used Lucide components),
 * used by the palette, the canvas, the `/` menu and the drag overlay so a field is recognisable at
 * a glance. Names come from the kit's icon set (src/portal/ui/icon.tsx).
 */
export const FIELD_ICON: Record<FieldType, IconName> = {
  email: 'mail',
  name: 'user-round',
  phone: 'phone',
  address: 'map-pin',
  country: 'globe',
  short_text: 'text-cursor-input',
  long_text: 'align-left',
  number: 'hash',
  url: 'link',
  date: 'calendar',
  time: 'clock',
  single_choice: 'circle-dot',
  multiple_choice: 'square-check',
  dropdown: 'square-chevron-down',
  yes_no: 'toggle-left',
  picture_choice: 'images',
  rating: 'star',
  nps: 'gauge',
  signature: 'signature',
  consent: 'file-check',
  section_break: 'separator-horizontal',
};
