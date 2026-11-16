import {useEffect, useMemo} from 'react';

import {ADDRESS_LINES, type AddressLine} from '../../lib/intelform/form/types/contact';
import {COUNTRY_CODES} from '../../lib/intelform/form/types/countries';
import type {FieldRendererProps} from '../../respondent/types';
import {Group, NativeSelect, SubLabel, TextInput} from '../../respondent/ui';
import {regionName} from '../../respondent/util';

const AUTOCOMPLETE: Record<AddressLine, string> = {
  street: 'address-line1',
  line2: 'address-line2',
  city: 'address-level2',
  state: 'address-level1',
  postal: 'postal-code',
  country: 'country',
};
const REQUIRED: AddressLine[] = ['street', 'city', 'country'];

type AddressValue = Partial<Record<AddressLine, string>>;

/** The next address answer after editing one line; undefined when every line is blank. */
export function nextAddressValue(current: AddressValue, line: AddressLine, text: string): AddressValue | undefined {
  const next = {...current, [line]: text};
  const empty = ADDRESS_LINES.every(l => !next[l] || !next[l]!.trim());
  return empty ? undefined : next;
}

/** One labelled input per enabled line; country is a select of localised names. */
export default function AddressRenderer(p: FieldRendererProps<'address'>) {
  const {field, value, onChange, labels, onAdvance} = p;
  const lines = ADDRESS_LINES.filter(l => field.props.lines[l]);
  const v = (value && typeof value === 'object' ? value : {}) as AddressValue;
  const countries = useMemo(() => COUNTRY_CODES.map(c => ({c, n: regionName(c)})).sort((a, b) => a.n.localeCompare(b.n)), []);
  const set = (line: AddressLine, text: string) => onChange(nextAddressValue(v, line, text));
  useEffect(() => {
    const def = field.props.defaultCountry;
    if (def && field.props.lines.country && !v.country) onChange({...v, country: def}, {silent: true});
    // First render only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const label: Record<AddressLine, string> = {
    street: labels.street,
    line2: labels.line2,
    city: labels.city,
    state: labels.state,
    postal: labels.postal,
    country: labels.country,
  };
  return (
    <Group legend={p.legend} description={p.description} error={p.error} required={field.required} legendClassName={p.large ? 'rf-question-xl' : undefined}>
      <div className="ft-pair-grid">
        {lines.map((line, i) => {
          const id = i === 0 ? p.inputId : `${p.inputId}-${line}`;
          const req = field.required && REQUIRED.includes(line);
          const wide = line === 'street' || line === 'line2';
          return (
            <div key={line} className={wide ? 'ft-sub-field ft-span-2' : 'ft-sub-field'}>
              <SubLabel htmlFor={id}>
                {label[line]}
                {req && (
                  <span aria-hidden className="rf-required">
                    {' '}*
                  </span>
                )}
              </SubLabel>
              {line === 'country' ? (
                <NativeSelect
                  id={id}
                  autoComplete="country"
                  aria-required={req || undefined}
                  invalid={p.invalid}
                  value={v.country ?? ''}
                  onChange={e => set('country', e.target.value)}>
                  <option value="">{labels.choose}</option>
                  {countries.map(({c, n}) => (
                    <option key={c} value={c}>
                      {n}
                    </option>
                  ))}
                </NativeSelect>
              ) : (
                <TextInput
                  id={id}
                  autoComplete={AUTOCOMPLETE[line]}
                  aria-required={req || undefined}
                  invalid={p.invalid}
                  value={v[line] ?? ''}
                  onValueChange={t => set(line, t)}
                  onAdvance={onAdvance}
                />
              )}
            </div>
          );
        })}
      </div>
    </Group>
  );
}
