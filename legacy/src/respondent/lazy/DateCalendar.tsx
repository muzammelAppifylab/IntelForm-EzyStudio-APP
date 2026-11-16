import { DayPicker, type Matcher } from 'react-day-picker'
import 'react-day-picker/style.css'

/** Calendar popover body for the date field (lazy: react-day-picker + date-fns load on first open). */
const toIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const fromIso = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export default function DateCalendar({
  selected,
  onSelect,
  minDate,
  maxDate,
  disablePast,
  disableFuture,
}: {
  selected: string | null
  onSelect: (iso: string) => void
  minDate: string | null
  maxDate: string | null
  disablePast: boolean
  disableFuture: boolean
}) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const disabled: Matcher[] = []
  if (minDate) disabled.push({ before: fromIso(minDate) })
  if (maxDate) disabled.push({ after: fromIso(maxDate) })
  if (disablePast) disabled.push({ before: today })
  if (disableFuture) disabled.push({ after: today })
  const sel = selected ? fromIso(selected) : undefined
  return (
    <DayPicker
      mode="single"
      autoFocus
      required={false}
      selected={sel}
      defaultMonth={sel ?? (minDate && fromIso(minDate) > today ? fromIso(minDate) : today)}
      captionLayout="dropdown"
      startMonth={minDate ? fromIso(minDate) : new Date(today.getFullYear() - 120, 0)}
      endMonth={maxDate ? fromIso(maxDate) : new Date(today.getFullYear() + 20, 11)}
      disabled={disabled}
      onSelect={(d) => d && onSelect(toIso(d))}
      className="if-calendar"
    />
  )
}
