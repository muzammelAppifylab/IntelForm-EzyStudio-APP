import {useMemo, useState} from 'react';

import {COUNTRY_CODES, countryName} from '../../../lib/intelform/form/types/registry';
import {Checkbox, Combobox, Icon, Popover} from '../../ui';
import {FieldRow} from './controls';

function useCountries() {
  return useMemo(() => COUNTRY_CODES.map(code => ({code, name: countryName(code)})).sort((a, b) => a.name.localeCompare(b.name)), []);
}

const NONE = '__none__';

/** One country, or none (the kit's `Combobox`: type to filter, arrows, Enter). */
export function CountrySelect({
  label,
  value,
  onChange,
  disabled,
  description,
}: {
  label: string;
  value: string | null;
  onChange(v: string | null): void;
  disabled?: boolean;
  description?: string;
}) {
  const countries = useCountries();
  const options = useMemo(() => [{value: NONE, label: 'None'}, ...countries.map(c => ({value: c.code, label: c.name, description: c.code}))], [countries]);
  return (
    <FieldRow label={label} description={description}>
      {({id, describedBy}) => (
        <Combobox
          id={id}
          describedBy={describedBy}
          value={value ?? NONE}
          onChange={v => onChange(v === NONE ? null : v)}
          options={options}
          placeholder="None"
          searchLabel="Search countries"
          emptyText="No country matches"
          disabled={disabled}
        />
      )}
    </FieldRow>
  );
}

/** What the multi picker's button says. Exported for tests. */
export function countrySummary(value: readonly string[]): string {
  if (value.length === 0) return 'All countries';
  if (value.length <= 3) return value.map(c => countryName(c)).join(', ');
  return `${value.length} countries`;
}

/** Several countries; empty means all. A popover with a search box and a checkbox per country. */
export function CountryMultiPicker({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string[];
  onChange(v: string[]): void;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState('');
  const countries = useCountries();
  const set = new Set(value);
  const q = query.trim().toLowerCase();
  const shown = q ? countries.filter(c => `${c.name} ${c.code}`.toLowerCase().includes(q)) : countries;
  return (
    <FieldRow label={label} description="Offer only these countries. Leave empty to offer every country.">
      {({id}) => (
        <Popover
          label={label}
          triggerId={id}
          triggerClassName="combobox-trigger"
          disabled={disabled}
          onOpenChange={open => !open && setQuery('')}
          trigger={
            <>
              <span className="combobox-value">{countrySummary(value)}</span>
              <Icon name="chevrons-up-down" size={16} />
            </>
          }>
          <div className="if-country-multi">
            <span className="combobox-search">
              <Icon name="search" size={16} />
              <input type="text" aria-label="Search countries" placeholder="Search countries" value={query} onChange={e => setQuery(e.target.value)} />
            </span>
            {value.length > 0 && (
              <button type="button" className="if-link-button" onClick={() => onChange([])}>
                Clear (offer all countries)
              </button>
            )}
            <ul className="if-country-list" aria-label="Countries">
              {shown.length === 0 && <li className="combobox-empty">No country matches</li>}
              {shown.map(c => (
                <li key={c.code}>
                  <Checkbox
                    label={c.name}
                    checked={set.has(c.code)}
                    onChange={on => onChange(on ? [...value, c.code] : value.filter(x => x !== c.code))}
                  />
                </li>
              ))}
            </ul>
          </div>
        </Popover>
      )}
    </FieldRow>
  );
}
