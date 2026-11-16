import { useState } from 'react'
import type { FieldRendererProps } from '@/respondent/types'
import { Group, NativeSelect } from '@/respondent/ui'

const pad = (n: number) => String(n).padStart(2, '0')

/** Hour / minute (/ AM-PM) selects built from the minute step; the answer is "HH:mm". */
export default function TimeRenderer(p: FieldRendererProps<'time'>) {
  const { field, value, onChange } = p
  const { hourCycle, step } = field.props
  const twelve = hourCycle === '12'
  const initial = typeof value === 'string' && /^\d{2}:\d{2}$/.test(value) ? value.split(':').map(Number) : null
  const [hour, setHour] = useState<number | null>(initial ? initial[0] : null)
  const [minute, setMinute] = useState<number | null>(initial ? initial[1] : null)

  const minutes: number[] = []
  for (let m = 0; m < 60; m += step) minutes.push(m)
  // With a step that doesn't divide the hour, only times on the step from 00:00 are valid.
  const allowedMinutes = (h: number | null) => (60 % step === 0 || h === null ? minutes : minutes.filter((m) => ((h * 60 + m) % step) === 0))
  const hours = Array.from({ length: 24 }, (_, h) => h).filter((h) => 60 % step === 0 || minutes.some((m) => (h * 60 + m) % step === 0))

  const emit = (h: number | null, m: number | null) => {
    setHour(h)
    setMinute(m)
    if (h === null && m === null) onChange(undefined, { invalid: null })
    else if (h === null || m === null) onChange(undefined, { invalid: 'invalidTime' })
    else onChange(`${pad(h)}:${pad(m)}`, { invalid: null })
  }
  const period = hour === null ? 'AM' : hour < 12 ? 'AM' : 'PM'
  const displayHour = hour === null ? '' : twelve ? String(hour % 12 === 0 ? 12 : hour % 12) : String(hour)
  const twelveHours = Array.from({ length: 12 }, (_, i) => i + 1)

  return (
    <Group legend={p.legend} description={p.description} error={p.error} required={field.required} legendClassName={p.large ? 'text-question-xl' : undefined}>
      <div className="flex flex-wrap items-center gap-2">
        <NativeSelect
          id={p.inputId}
          aria-label={p.labels.hour}
          invalid={p.invalid}
          className="w-24"
          value={displayHour}
          onChange={(e) => {
            const v = e.target.value
            if (v === '') return emit(null, minute)
            let h = Number(v)
            if (twelve) h = (h % 12) + (period === 'PM' ? 12 : 0)
            emit(h, minute)
          }}
        >
          <option value="">--</option>
          {(twelve ? twelveHours : hours).map((h) => (
            <option key={h} value={h}>
              {twelve ? h : pad(h)}
            </option>
          ))}
        </NativeSelect>
        <span aria-hidden className="text-answer text-muted-foreground">
          :
        </span>
        <NativeSelect
          aria-label={p.labels.minute}
          invalid={p.invalid}
          className="w-24"
          value={minute === null ? '' : String(minute)}
          onChange={(e) => emit(hour, e.target.value === '' ? null : Number(e.target.value))}
        >
          <option value="">--</option>
          {allowedMinutes(hour).map((m) => (
            <option key={m} value={m}>
              {pad(m)}
            </option>
          ))}
        </NativeSelect>
        {twelve && (
          <NativeSelect
            aria-label={p.labels.amPm}
            className="w-24"
            value={period}
            onChange={(e) => {
              if (hour === null) return
              const base = hour % 12
              emit(e.target.value === 'PM' ? base + 12 : base, minute)
            }}
          >
            <option value="AM">AM</option>
            <option value="PM">PM</option>
          </NativeSelect>
        )}
      </div>
    </Group>
  )
}
