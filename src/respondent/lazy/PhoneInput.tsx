import { useEffect, useMemo, useState, type RefObject } from 'react'
import { ChevronDown } from 'lucide-react'
import { AsYouType, getCountries, getCountryCallingCode, parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js/min'
import { clsx } from 'clsx'
import type { FieldRendererProps } from '../types'
import { TextInput } from '../ui'
import { CONTROL, guessCountry, regionName } from '../util'

/**
 * Phone input (lazy chunk: libphonenumber-js /min metadata + flags). A country select with the
 * flag and dial code, and a tel input formatted as you type. The answer is E.164 when the
 * number parses; otherwise the raw text, which the shared validator rejects with invalidPhone.
 * The server re-checks with the full /max metadata.
 */
const FLAGS = import.meta.glob<string>('/node_modules/country-flag-icons/string/3x2/*.js', { import: 'default' })

function Flag({ code }: { code: string }) {
  const [svg, setSvg] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    const load = FLAGS[`/node_modules/country-flag-icons/string/3x2/${code}.js`]
    setSvg(null)
    load?.().then((s) => alive && setSvg(s)).catch(() => {})
    return () => {
      alive = false
    }
  }, [code])
  return (
    <span aria-hidden className="block h-4 w-6 shrink-0 overflow-hidden rounded-[2px] bg-muted">
      {svg && <img alt="" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`} className="size-full object-cover" />}
    </span>
  )
}

export default function PhoneInput({
  field,
  value,
  onChange,
  inputId,
  describedBy,
  invalid,
  onAdvance,
  labels,
  restoreFocus,
}: FieldRendererProps<'phone'> & { restoreFocus?: RefObject<boolean> }) {
  // The stand-in tel input had focus when this chunk loaded: take it over.
  useEffect(() => {
    if (restoreFocus?.current && (!document.activeElement || document.activeElement === document.body)) {
      document.getElementById(inputId)?.focus({ preventScroll: true })
    }
  }, [restoreFocus, inputId])

  const countries = useMemo(
    () =>
      getCountries()
        .map((c) => ({ code: c, name: regionName(c), dial: getCountryCallingCode(c) }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [],
  )
  const initialCountry = (): CountryCode => {
    const known = new Set<string>(getCountries())
    if (typeof value === 'string' && value.startsWith('+')) {
      const c = parsePhoneNumberFromString(value)?.country
      if (c) return c
    }
    const pick = field.props.defaultCountry ?? guessCountry()
    return (pick && known.has(pick) ? pick : 'US') as CountryCode
  }
  const [country, setCountry] = useState<CountryCode>(initialCountry)
  const [text, setText] = useState(() => {
    if (typeof value !== 'string') return ''
    const p = parsePhoneNumberFromString(value)
    return p ? (p.country === country ? p.formatNational() : p.formatInternational()) : value
  })

  const emit = (raw: string, c: CountryCode) => {
    if (raw.trim() === '') return onChange(undefined)
    const parsed = parsePhoneNumberFromString(raw, c)
    onChange(parsed && parsed.isPossible() ? parsed.number : raw)
  }

  const update = (raw: string) => {
    let next = raw
    // Format only while typing forward at the end, so editing in the middle never jumps the caret.
    if (raw.length > text.length && raw.startsWith(text)) {
      next = raw.trim().startsWith('+') ? new AsYouType().input(raw) : new AsYouType(country).input(raw)
    }
    setText(next)
    if (next.trim().startsWith('+')) {
      const c = parsePhoneNumberFromString(next)?.country
      if (c && c !== country) setCountry(c)
    }
    emit(next, country)
  }

  const current = countries.find((c) => c.code === country)
  return (
    <div className="flex max-w-md gap-2">
      <span className={clsx(CONTROL, 'relative flex shrink-0 items-center gap-2 border border-input bg-field pr-8 text-foreground has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring')}>
        <Flag code={country} />
        <span aria-hidden className="tabular-nums">
          +{current?.dial}
        </span>
        <ChevronDown aria-hidden className="absolute right-2.5 size-4 text-muted-foreground" />
        <select
          aria-label={`${labels.country}: ${current?.name ?? country}`}
          value={country}
          onChange={(e) => {
            const c = e.target.value as CountryCode
            setCountry(c)
            const national = text.trim().startsWith('+') ? (parsePhoneNumberFromString(text)?.formatNational() ?? '') : text
            setText(national)
            emit(national, c)
          }}
          className="absolute inset-0 cursor-pointer opacity-0"
        >
          {countries.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name} (+{c.dial})
            </option>
          ))}
        </select>
      </span>
      <TextInput
        id={inputId}
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        placeholder={field.placeholder || undefined}
        aria-describedby={describedBy}
        aria-required={field.required || undefined}
        invalid={invalid}
        value={text}
        onValueChange={update}
        onAdvance={onAdvance}
        className="tabular-nums"
      />
    </div>
  )
}
