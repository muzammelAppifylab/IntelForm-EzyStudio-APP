import {type ReactNode, useEffect, useId, useRef, useState} from 'react';

import {CONTACT_HAS, type ContactHas, contactsFilterQuery, type ContactsOverviewResponse} from '../../../lib/intelform/api-contacts';
import {Button, Checkbox, Collapsible, DatePicker, Drawer, Field, ScrollArea, SearchInput, toIsoDate} from '../../ui';
import {restoreFocusIfLost} from '../lib/focus';
import {type AdvancedFilters, advancedCount, NO_ADVANCED} from '../queries/contacts';
import {FormStatus} from './bits';
import {countryLabel, formatNumber} from './format';

type Facets = ContactsOverviewResponse['facets'];

export const HAS_LABEL: Record<ContactHas, string> = {email: 'Email', phone: 'Phone number', name: 'Name'};

type RangeErrors = Partial<Record<'from' | 'to' | 'min' | 'max', string>>;

/** Checks the drafted filters with the same schema the server uses. */
export function checkFilters(draft: AdvancedFilters, minText: string, maxText: string) {
  const toCount = (t: string) => (t.trim() === '' ? undefined : Number(t));
  const parsed = contactsFilterQuery.safeParse({...draft, min: toCount(minText), max: toCount(maxText), from: draft.from || undefined, to: draft.to || undefined});
  const errors: RangeErrors = {};
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const k = issue.path[0];
      if ((k === 'from' || k === 'to' || k === 'min' || k === 'max') && !errors[k]) {
        errors[k] = (k === 'min' || k === 'max') && (issue.code === 'invalid_type' || issue.code === 'too_small') ? 'Use a whole number of 1 or more' : issue.message;
      }
    }
  }
  const value: AdvancedFilters | null = parsed.success
    ? {form: parsed.data.form, country: parsed.data.country, has: parsed.data.has, from: parsed.data.from, to: parsed.data.to, min: parsed.data.min, max: parsed.data.max}
    : null;
  return {value, errors};
}

/** The "Filters" button (with how many are on) and its drawer. */
export function FiltersButton({value, facets, onApply}: {value: AdvancedFilters; facets: Facets | undefined; onApply: (f: AdvancedFilters) => void}) {
  const [open, setOpen] = useState(false);
  const n = advancedCount(value);
  // The drawer unmounts on close (each opening starts from the applied filters), which takes its
  // <dialog> out of the page before the browser can hand focus back: return it to this button.
  const opener = useRef<HTMLButtonElement | null>(null);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !open) restoreFocusIfLost(() => opener.current);
    wasOpen.current = open;
  }, [open]);
  return (
    <>
      <Button
        variant="secondary"
        icon="sliders"
        onClick={event => {
          opener.current = event.currentTarget;
          setOpen(true);
        }}
        aria-label={n ? `Filters, ${n} active` : 'Filters'}>
        Filters
        {n > 0 && (
          <span className="contacts-count-pill" aria-hidden="true">
            {n}
          </span>
        )}
      </Button>
      {open && (
        <FiltersDrawer
          initial={value}
          facets={facets}
          onClose={() => setOpen(false)}
          onApply={f => {
            onApply(f);
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

function FiltersDrawer({initial, facets, onClose, onApply}: {initial: AdvancedFilters; facets: Facets | undefined; onClose: () => void; onApply: (f: AdvancedFilters) => void}) {
  const [draft, setDraft] = useState<AdvancedFilters>(initial);
  const [minText, setMinText] = useState(initial.min?.toString() ?? '');
  const [maxText, setMaxText] = useState(initial.max?.toString() ?? '');
  const [today] = useState(() => toIsoDate(new Date()));
  const ids = useId();
  const set = (patch: Partial<AdvancedFilters>) => setDraft(d => ({...d, ...patch}));
  const {value, errors} = checkFilters(draft, minText, maxText);

  return (
    <Drawer
      open
      onClose={onClose}
      title="Filters"
      description="Contacts must match every section."
      onSubmit={event => {
        event.preventDefault();
        if (value) onApply(value);
      }}
      footer={
        <>
          <Button
            variant="ghost"
            onClick={() => {
              setDraft(NO_ADVANCED);
              setMinText('');
              setMaxText('');
            }}>
            Reset all
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!value}>
            Apply filters
          </Button>
        </>
      }>
      <div className="contacts-filters">
        <Section title="Forms" hint="Contacts who answered any of these" count={draft.form.length} defaultOpen>
          <MultiPick
            label="forms"
            items={(facets?.forms ?? []).map(f => ({
              value: f.id,
              search: f.title,
              label: f.title,
              extra: (
                <>
                  <FormStatus status={f.status} />
                  <span className="contacts-pick-count">{formatNumber(f.contacts)}</span>
                </>
              ),
            }))}
            selected={draft.form}
            onChange={form => set({form})}
          />
        </Section>
        <Section title="Country" hint="From each contact’s latest response" count={draft.country.length}>
          <MultiPick
            label="countries"
            items={(facets?.countries ?? []).map(c => ({
              value: c.code,
              search: `${countryLabel(c.code)} ${c.code}`,
              label: countryLabel(c.code),
              extra: <span className="contacts-pick-count">{formatNumber(c.contacts)}</span>,
            }))}
            selected={draft.country}
            onChange={country => set({country})}
          />
        </Section>
        <Section title="Has details" hint="Every ticked detail must be present" count={draft.has.length}>
          <div className="contacts-checks">
            {CONTACT_HAS.map(h => (
              <Checkbox
                key={h}
                label={HAS_LABEL[h]}
                checked={draft.has.includes(h)}
                onChange={on => set({has: CONTACT_HAS.filter(x => (x === h ? on : draft.has.includes(x)))})}
              />
            ))}
          </div>
        </Section>
        <Section title="Last active" hint="Between these dates, inclusive" count={draft.from || draft.to ? 1 : 0}>
          <div className="contacts-pair">
            <Field id={`${ids}-from`} label="From" error={errors.from}>
              <DatePicker id={`${ids}-from`} value={draft.from ?? null} max={today} clearable onChange={v => set({from: v ?? undefined})} />
            </Field>
            <Field id={`${ids}-to`} label="To" error={errors.to}>
              <DatePicker id={`${ids}-to`} value={draft.to ?? null} max={today} clearable onChange={v => set({to: v ?? undefined})} />
            </Field>
          </div>
        </Section>
        <Section title="Responses sent" hint="Leave a side empty for no limit" count={minText.trim() || maxText.trim() ? 1 : 0}>
          <div className="contacts-pair">
            <Field id={`${ids}-min`} label="At least" error={errors.min}>
              <input
                id={`${ids}-min`}
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                placeholder="1"
                value={minText}
                aria-invalid={errors.min ? true : undefined}
                onChange={e => setMinText(e.target.value)}
              />
            </Field>
            <Field id={`${ids}-max`} label="At most" error={errors.max}>
              <input
                id={`${ids}-max`}
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                placeholder="Any"
                value={maxText}
                aria-invalid={errors.max ? true : undefined}
                onChange={e => setMaxText(e.target.value)}
              />
            </Field>
          </div>
        </Section>
      </div>
    </Drawer>
  );
}

/** A collapsible section whose title says how many picks it holds, so closed ones still tell the story. */
function Section({title, hint, count, defaultOpen, children}: {title: string; hint: string; count: number; defaultOpen?: boolean; children: ReactNode}) {
  return (
    <Collapsible
      title={title}
      description={hint}
      defaultOpen={defaultOpen || count > 0}
      actions={
        count > 0 ? (
          <span className="contacts-count-pill">
            {count}
            <span className="visually-hidden"> picked</span>
          </span>
        ) : undefined
      }>
      {children}
    </Collapsible>
  );
}

interface PickItem {
  value: string;
  search: string;
  label: string;
  extra?: ReactNode;
}

/** A searchable checklist; what was picked when it opened stays on top. */
function MultiPick({label, items, selected, onChange}: {label: string; items: PickItem[]; selected: string[]; onChange: (v: string[]) => void}) {
  const [pinned] = useState(() => new Set(selected));
  const [term, setTerm] = useState('');
  if (!items.length) return <p className="muted">Nothing to pick yet.</p>;
  const needle = term.trim().toLowerCase();
  const list = [...items]
    .sort((a, b) => Number(pinned.has(b.value)) - Number(pinned.has(a.value)))
    .filter(it => !needle || it.search.toLowerCase().includes(needle));
  const toggle = (v: string, on: boolean) => onChange(on ? [...selected.filter(x => x !== v), v] : selected.filter(x => x !== v));
  return (
    <div className="contacts-pick">
      {items.length > 6 && <SearchInput label={`Search ${label}`} placeholder={`Search ${label}`} value={term} onChange={e => setTerm(e.target.value)} />}
      <ScrollArea label={`Pick ${label}`} size="sm">
        {list.length === 0 ? (
          <p className="muted">No {label} match.</p>
        ) : (
          <ul className="contacts-pick-list">
            {list.map(it => (
              <li key={it.value} className="contacts-pick-item">
                <Checkbox label={it.label} checked={selected.includes(it.value)} onChange={on => toggle(it.value, on)} />
                {it.extra}
              </li>
            ))}
          </ul>
        )}
      </ScrollArea>
      {selected.length > 0 && (
        <div className="contacts-pick-foot">
          <span>{formatNumber(selected.length)} picked</span>
          <Button variant="link" size="sm" onClick={() => onChange([])}>
            Clear
          </Button>
        </div>
      )}
    </div>
  );
}
