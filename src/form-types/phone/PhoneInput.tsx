import {AsYouType, type CountryCode, getCountries, getCountryCallingCode, parsePhoneNumberFromString} from 'libphonenumber-js/min';
import {type RefObject, useEffect, useMemo, useState} from 'react';

import type {FieldRendererProps} from '../../respondent/types';
import {TextInput} from '../../respondent/ui';
import {CONTROL, cx, guessCountry, regionName} from '../../respondent/util';
import {FtIcon} from '../_respondent/icons';

/**
 * Phone input (a lazy chunk: libphonenumber-js /min metadata + flags). A country select with
 * the flag and dial code, and a tel input formatted as you type. The answer is E.164 when the
 * number parses; otherwise the raw text, which the shared validator rejects with invalidPhone.
 * The server re-checks.
 *
 * Flags come from country-flag-icons as SVG strings, one tiny module per country loaded on
 * demand, shown as a data: image (img-src allows data:; no inline style anywhere).
 */
const FLAGS = import.meta.glob<string>('/node_modules/country-flag-icons/string/3x2/*.js', {import: 'default'});

function Flag({code}: {code: string}) {
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const load = FLAGS[`/node_modules/country-flag-icons/string/3x2/${code}.js`];
    setSvg(null);
    load?.()
      .then(s => alive && setSvg(s))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [code]);
  return (
    <span aria-hidden className="ft-flag">
      {svg && <img alt="" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`} className="ft-flag-img" />}
    </span>
  );
}

/** The starting dial-code country: the stored number's, else the field default, the browser's, US. */
export function initialPhoneCountry(value: unknown, defaultCountry: string | null, guess: string | null): CountryCode {
  const known = new Set<string>(getCountries());
  if (typeof value === 'string' && value.startsWith('+')) {
    const c = parsePhoneNumberFromString(value)?.country;
    if (c) return c;
  }
  const pick = defaultCountry ?? guess;
  return (pick && known.has(pick) ? pick : 'US') as CountryCode;
}

/** The answer for typed text: E.164 when it is a possible number in `country`, else the raw text. */
export function phoneAnswer(raw: string, country: CountryCode): string | undefined {
  if (raw.trim() === '') return undefined;
  const parsed = parsePhoneNumberFromString(raw, country);
  return parsed && parsed.isPossible() ? parsed.number : raw;
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
}: FieldRendererProps<'phone'> & {restoreFocus?: RefObject<boolean>}) {
  // The stand-in tel input had focus when this chunk loaded: take it over.
  useEffect(() => {
    if (restoreFocus?.current && (!document.activeElement || document.activeElement === document.body)) {
      document.getElementById(inputId)?.focus({preventScroll: true});
    }
  }, [restoreFocus, inputId]);

  const countries = useMemo(
    () =>
      getCountries()
        .map(c => ({code: c, name: regionName(c), dial: getCountryCallingCode(c)}))
        .sort((a, b) => a.name.localeCompare(b.name)),
    []
  );
  const [country, setCountry] = useState<CountryCode>(() => initialPhoneCountry(value, field.props.defaultCountry, guessCountry()));
  const [text, setText] = useState(() => {
    if (typeof value !== 'string') return '';
    const p = parsePhoneNumberFromString(value);
    return p ? (p.country === country ? p.formatNational() : p.formatInternational()) : value;
  });

  const emit = (raw: string, c: CountryCode) => onChange(phoneAnswer(raw, c));

  const update = (raw: string) => {
    let next = raw;
    // Format only while typing forward at the end, so editing in the middle never jumps the caret.
    if (raw.length > text.length && raw.startsWith(text)) {
      next = raw.trim().startsWith('+') ? new AsYouType().input(raw) : new AsYouType(country).input(raw);
    }
    setText(next);
    if (next.trim().startsWith('+')) {
      const c = parsePhoneNumberFromString(next)?.country;
      if (c && c !== country) setCountry(c);
    }
    emit(next, country);
  };

  const current = countries.find(c => c.code === country);
  return (
    <div className="ft-phone">
      <span className={cx(CONTROL, 'rf-input ft-phone-country')}>
        <Flag code={country} />
        <span aria-hidden className="ft-tabular">
          +{current?.dial}
        </span>
        <FtIcon name="chevron-down" className="ft-phone-chevron" />
        <select
          aria-label={`${labels.country}: ${current?.name ?? country}`}
          value={country}
          onChange={e => {
            const c = e.target.value as CountryCode;
            setCountry(c);
            const national = text.trim().startsWith('+') ? (parsePhoneNumberFromString(text)?.formatNational() ?? '') : text;
            setText(national);
            emit(national, c);
          }}
          className="ft-phone-select">
          {countries.map(c => (
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
        className="ft-tabular"
      />
    </div>
  );
}
