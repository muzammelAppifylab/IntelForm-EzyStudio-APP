import {
  AlignLeft,
  CalendarDays,
  CircleDot,
  Clock,
  FileCheck,
  Gauge,
  Globe,
  Hash,
  Images,
  Link,
  Mail,
  MapPin,
  Phone,
  SeparatorHorizontal,
  Signature,
  SquareCheck,
  SquareChevronDown,
  Star,
  TextCursorInput,
  ToggleLeft,
  UserRound,
  type LucideIcon,
} from 'lucide-react'
import type { FieldType } from '@shared/form/field-types'

/**
 * One fixed Lucide icon per field type, used in the builder palette, the canvas, logic rules and
 * response summaries so a field is recognisable at a glance (design system "Iconography").
 * Render at 16px in dense UI, 20px elsewhere, coloured with currentColor.
 */
export const FIELD_ICONS: Record<FieldType, LucideIcon> = {
  email: Mail,
  name: UserRound,
  phone: Phone,
  address: MapPin,
  country: Globe,
  short_text: TextCursorInput,
  long_text: AlignLeft,
  number: Hash,
  url: Link,
  date: CalendarDays,
  time: Clock,
  single_choice: CircleDot,
  multiple_choice: SquareCheck,
  dropdown: SquareChevronDown,
  yes_no: ToggleLeft,
  picture_choice: Images,
  rating: Star,
  nps: Gauge,
  signature: Signature,
  consent: FileCheck,
  section_break: SeparatorHorizontal,
}
