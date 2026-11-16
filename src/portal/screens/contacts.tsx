import {useInfiniteQuery, useQuery} from '@tanstack/react-query';
import {Link} from '@tanstack/react-router';
import {useCallback, useEffect, useMemo, useState} from 'react';

import {
  CONTACT_SEGMENT_LABEL,
  CONTACT_SEGMENTS,
  CONTACT_SORT_LABEL,
  CONTACT_SORTS,
  type ContactRow,
  type ContactSort,
} from '../../lib/intelform/api-contacts';
import {FormChips, useCopy} from '../intelform/contacts/bits';
import {ContactDrawer} from '../intelform/contacts/ContactDrawer';
import {FiltersButton, HAS_LABEL} from '../intelform/contacts/Filters';
import {
  contactSubtitle,
  contactTitle,
  countRangeLabel,
  countryLabel,
  dateRangeLabel,
  formatDate,
  formatNumber,
  formatPhone,
  plural,
} from '../intelform/contacts/format';
import {COLUMN_LABEL, COLUMNS, type ColumnId, useHiddenColumns} from '../intelform/contacts/prefs';
import {Strip} from '../intelform/contacts/Strip';
import {useCan} from '../intelform/lib/can';
import {
  type AdvancedFilters,
  advancedCount,
  clearFilters,
  type ContactsState,
  contactsCsvUrl,
  contactsListQuery,
  contactsOverviewQuery,
  DEFAULT_CONTACTS_STATE,
  defaultDir,
  isFiltered,
  useDeleteContacts,
} from '../intelform/queries/contacts';
import {ago, when} from '../shared';
import {
  Avatar,
  Button,
  buttonClass,
  Card,
  Checkbox,
  type Column,
  DataTable,
  EmptyState,
  ErrorNote,
  Icon,
  IconButton,
  LoadMore,
  Menu,
  type MenuItem,
  PageHeader,
  Popover,
  SearchInput,
  SegmentedControl,
  Select,
  useConfirm,
  useToast,
} from '../ui';

/** What the delete dialog is about to erase. */
interface DeleteTarget {
  keys: string[];
  responses: number;
  name?: string;
}

/**
 * `/contacts` (site:contact:read): everyone who answered a form with an email or phone, one row
 * per person, with everything they sent. Erasing a contact (site:contact:write) deletes every
 * response they sent, on every form. Emails only ever reach holders of site:contact:read: every
 * contacts route checks it.
 */
export function Contacts() {
  const [state, setState] = useState<ContactsState>(DEFAULT_CONTACTS_STATE);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [hidden, setHidden] = useHiddenColumns();
  const canDelete = useCan('editContacts');
  const del = useDeleteContacts();
  const confirm = useConfirm();
  const toast = useToast();
  const copy = useCopy();

  const update = useCallback((patch: Partial<ContactsState>) => setState(s => ({...s, ...patch})), []);

  // Search reaches the query 250 ms after typing stops.
  const [q, setQ] = useState(state.q);
  useEffect(() => {
    const next = q.trim();
    if (next === state.q) return;
    const t = window.setTimeout(() => update({q: next}), 250);
    return () => window.clearTimeout(t);
  }, [q, state.q, update]);

  const list = useInfiniteQuery(contactsListQuery(state));
  const overview = useQuery(contactsOverviewQuery);
  const strip = overview.data?.strip;
  const facets = overview.data?.facets;
  const total = list.data?.pages.at(-1)?.total;
  // A contact can move between pages while paging (a new response): show it once.
  const rows = useMemo(() => {
    if (!list.data) return undefined;
    const seen = new Set<string>();
    return list.data.pages.flatMap(p => p.contacts).filter(c => (seen.has(c.key) ? false : (seen.add(c.key), true)));
  }, [list.data]);

  // Selection is cleared whenever the filters or sort change.
  const [selected, setSelected] = useState<Map<string, ContactRow>>(() => new Map());
  const stateSig = JSON.stringify(state);
  const [selectionSig, setSelectionSig] = useState(stateSig);
  if (stateSig !== selectionSig) {
    setSelectionSig(stateSig);
    setSelected(new Map());
  }
  const select = useCallback((targets: ContactRow[], on: boolean) => {
    setSelected(prev => {
      const next = new Map(prev);
      for (const r of targets) {
        if (on) next.set(r.key, r);
        else next.delete(r.key);
      }
      return next;
    });
  }, []);

  const csvFor = useCallback((keys: string[]) => contactsCsvUrl(state, keys), [state]);

  const askDelete = (target: DeleteTarget) => {
    const one = target.keys.length === 1;
    const responses = target.responses === 1 ? 'the 1 response' : `all ${plural(target.responses, 'response')}`;
    void confirm({
      title: one ? `Delete ${target.name ?? 'this contact'}?` : `Delete ${formatNumber(target.keys.length)} contacts?`,
      body: `This permanently deletes ${responses} from ${one ? 'this contact' : 'these contacts'} across all forms. Form summaries and counts update, and it can’t be undone. Export a CSV first if you need a copy.`,
      confirmLabel: one ? 'Delete contact' : `Delete ${formatNumber(target.keys.length)} contacts`,
      pendingLabel: 'Deleting…',
      action: async () => {
        const res = await del.mutateAsync(target.keys);
        toast.success(res.contacts === 1 ? 'Contact deleted.' : `${formatNumber(res.contacts)} contacts deleted.`);
        setSelected(prev => {
          const next = new Map(prev);
          for (const k of target.keys) next.delete(k);
          return next;
        });
        if (openKey && target.keys.includes(openKey)) setOpenKey(null);
      },
    });
  };
  const deleteRows = canDelete
    ? (targets: ContactRow[]) =>
        askDelete({
          keys: targets.map(r => r.key),
          responses: targets.reduce((n, r) => n + r.responseCount, 0),
          name: targets.length === 1 ? contactTitle(targets[0]!) : undefined,
        })
    : null;

  const setAdvanced = (f: Partial<AdvancedFilters>) => update(f);
  const sortBy = (s: ContactSort) => update({sort: s, dir: defaultDir(s)});
  const filtered = isFiltered(state);
  const noContacts = strip?.total === 0;
  const advanced: AdvancedFilters = {form: state.form, country: state.country, has: state.has, from: state.from, to: state.to, min: state.min, max: state.max};
  const show = (c: ColumnId) => !hidden.includes(c);

  const pageRows = rows ?? [];
  const allOnPage = pageRows.length > 0 && pageRows.every(r => selected.has(r.key));

  const columns: Column<ContactRow>[] = [
    {
      key: 'select',
      header: (
        <Checkbox
          label={<span className="visually-hidden">Select all shown</span>}
          checked={allOnPage}
          onChange={on => select(pageRows, on)}
        />
      ),
      width: 'shrink',
      cell: r => (
        <Checkbox
          label={<span className="visually-hidden">Select {contactTitle(r)}</span>}
          checked={selected.has(r.key)}
          onChange={on => select([r], on)}
        />
      ),
    },
    {
      key: 'contact',
      header: 'Contact',
      cell: r => {
        const sub = contactSubtitle(r);
        return (
          <span className="person">
            <Avatar name={contactTitle(r)} size="sm" />
            <span className="person-text">
              <button type="button" className="contacts-open" onClick={() => setOpenKey(r.key)} aria-current={r.key === openKey || undefined}>
                {contactTitle(r)}
              </button>
              {sub && <span className="person-detail">{sub}</span>}
            </span>
          </span>
        );
      },
    },
    ...(show('phone') ? [{key: 'phone', header: 'Phone', hideOnMobile: true, cell: (r: ContactRow) => (r.phone ? formatPhone(r.phone) : <span className="muted">–</span>)}] : []),
    ...(show('country') ? [{key: 'country', header: 'Country', hideOnMobile: true, cell: (r: ContactRow) => countryLabel(r.country)}] : []),
    ...(show('forms') ? [{key: 'forms', header: 'Forms', cell: (r: ContactRow) => <FormChips forms={r.forms} total={r.formCount} limit={1} />}] : []),
    ...(show('responses')
      ? [{key: 'responses', header: 'Responses', align: 'end' as const, width: 'shrink' as const, cell: (r: ContactRow) => formatNumber(r.responseCount)}]
      : []),
    ...(show('firstSeen')
      ? [
          {
            key: 'firstSeen',
            header: 'First seen',
            width: 'shrink' as const,
            hideOnMobile: true,
            cell: (r: ContactRow) => (
              <time dateTime={r.firstSeen} title={when(r.firstSeen)}>
                {formatDate(r.firstSeen)}
              </time>
            ),
          },
        ]
      : []),
    ...(show('lastSeen')
      ? [
          {
            key: 'lastSeen',
            header: 'Last active',
            width: 'shrink' as const,
            cell: (r: ContactRow) => (
              <time dateTime={r.lastSeen} title={when(r.lastSeen)}>
                {ago(r.lastSeen)}
              </time>
            ),
          },
        ]
      : []),
    {
      key: 'actions',
      header: 'Actions',
      actions: true,
      cell: r => {
        const items: MenuItem[] = [{label: 'View details', icon: 'eye', onSelect: () => setOpenKey(r.key)}];
        if (r.email) items.push({label: 'Copy email', icon: 'copy', onSelect: () => void copy(r.email!, 'Email copied.')});
        items.push({label: 'Export CSV', icon: 'download', onSelect: () => download(csvFor([r.key]))});
        if (deleteRows) items.push('separator', {label: 'Delete', icon: 'trash', danger: true, onSelect: () => deleteRows([r])});
        return <Menu label={`Actions for ${contactTitle(r)}`} items={items} />;
      },
    },
  ];

  const chips = activeChips(advanced, facets, setAdvanced);
  const segmentCount = {all: strip?.total, new: strip?.newThisWeek, returning: strip?.returning};

  return (
    <div className="app-page screen-contacts">
      <PageHeader
        title="Contacts"
        description="Everyone who answered your forms, in one place."
        actions={
          rows && !noContacts ? (
            <a className={buttonClass({variant: 'secondary'})} href={contactsCsvUrl(state)} download>
              <Icon name="download" size={18} />
              Export CSV
            </a>
          ) : (
            <Button variant="secondary" icon="download" disabled>
              Export CSV
            </Button>
          )
        }
      />

      {overview.error && !strip ? (
        <ErrorNote error={overview.error} title="Contacts didn’t load" />
      ) : noContacts ? (
        <Card>
          <EmptyState
            icon="contact"
            title="No contacts yet"
            action={
              <Link to="/forms" className={buttonClass()}>
                Go to forms
              </Link>
            }>
            Contacts appear here when a form with an Email or Phone field gets responses. Each person shows up once, with everything they sent.
          </EmptyState>
        </Card>
      ) : (
        <>
          <Strip
            strip={strip}
            activeForms={state.form}
            onForm={id => update({form: state.form.length === 1 && state.form[0] === id ? [] : [id]})}
          />

          <div className="toolbar contacts-toolbar">
            <div className="toolbar-group contacts-search">
              <SearchInput label="Search contacts by name, email or phone" placeholder="Search name, email or phone" value={q} onChange={e => setQ(e.target.value)} />
            </div>
            <SegmentedControl
              label="Show"
              value={state.segment}
              onChange={segment => update({segment})}
              options={CONTACT_SEGMENTS.map(s => ({
                value: s,
                label: segmentCount[s] === undefined ? CONTACT_SEGMENT_LABEL[s] : `${CONTACT_SEGMENT_LABEL[s]} ${formatNumber(segmentCount[s])}`,
              }))}
            />
            <div className="toolbar-group">
              <FiltersButton value={advanced} facets={facets} onApply={setAdvanced} />
              <Select
                aria-label="Sort contacts"
                value={state.sort}
                onChange={e => sortBy(e.target.value as ContactSort)}
                options={CONTACT_SORTS.map(s => ({value: s, label: CONTACT_SORT_LABEL[s]}))}
              />
              <IconButton
                variant="secondary"
                icon={state.dir === 'asc' ? 'sort-asc' : 'sort-desc'}
                label={state.dir === 'asc' ? 'Ascending, switch to descending' : 'Descending, switch to ascending'}
                onClick={() => update({dir: state.dir === 'asc' ? 'desc' : 'asc'})}
              />
              <Popover label="Show or hide columns" align="end" triggerClassName={buttonClass({variant: 'secondary'})} trigger={<Icon name="columns" size={18} />}>
                <div className="contacts-columns">
                  {COLUMNS.map(c => (
                    <Checkbox
                      key={c}
                      label={COLUMN_LABEL[c]}
                      checked={!hidden.includes(c)}
                      onChange={on => setHidden(on ? hidden.filter(x => x !== c) : [...hidden, c])}
                    />
                  ))}
                  <Button variant="link" size="sm" disabled={hidden.length === 0} onClick={() => setHidden([])}>
                    Show all columns
                  </Button>
                </div>
              </Popover>
            </div>
          </div>

          {chips.length > 0 && (
            <ul className="contacts-active" aria-label="Active filters">
              {chips.map(c => (
                <li key={c.key} className="contacts-active-chip">
                  <span>{c.label}</span>
                  <IconButton icon="x" size="sm" label={`Remove filter: ${c.label}`} onClick={c.remove} />
                </li>
              ))}
              <li>
                <Button variant="link" size="sm" onClick={() => setAdvanced({form: [], country: [], has: [], from: undefined, to: undefined, min: undefined, max: undefined})}>
                  Clear all
                </Button>
              </li>
            </ul>
          )}

          <Card flush>
            <div aria-busy={list.isFetching || undefined} className={list.isPlaceholderData ? 'contacts-stale' : undefined}>
              <DataTable
                caption="Contacts"
                columns={columns}
                rows={rows}
                rowKey={r => r.key}
                loading={list.isPending}
                error={list.error}
                empty={
                  <EmptyState
                    icon="search-x"
                    title="No contacts match"
                    action={
                      filtered ? (
                        <Button
                          variant="secondary"
                          onClick={() => {
                            setQ('');
                            setState(clearFilters(state));
                          }}>
                          Clear filters
                        </Button>
                      ) : undefined
                    }>
                    {filtered ? 'Try another search, or clear the filters.' : 'Nobody has left an email or phone number yet.'}
                  </EmptyState>
                }
              />
            </div>
          </Card>
          <LoadMore query={list} />

          {selected.size > 0 && (
            <div role="region" aria-label="Selection" className="contacts-bulk">
              <span className="contacts-bulk-count">{formatNumber(selected.size)} selected</span>
              <a className={buttonClass({variant: 'secondary', size: 'sm'})} href={csvFor([...selected.keys()])} download>
                <Icon name="download" size={16} />
                Export CSV
              </a>
              {deleteRows && (
                <Button variant="danger" size="sm" icon="trash" onClick={() => deleteRows([...selected.values()])}>
                  Delete
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={() => setSelected(new Map())}>
                Clear selection
              </Button>
            </div>
          )}

          <p className="visually-hidden" role="status">
            {total !== undefined ? `${plural(total, 'contact')} ${filtered ? 'found' : 'in total'}` : ''}
          </p>
        </>
      )}

      <ContactDrawer
        contactKey={openKey}
        onClose={() => setOpenKey(null)}
        csvFor={csvFor}
        onDelete={
          canDelete
            ? d => askDelete({keys: [d.contact.key], responses: d.contact.responseCount, name: contactTitle(d.contact)})
            : null
        }
      />
    </div>
  );
}

/** Starts a same-origin download (the CSV) from a menu item. */
function download(href: string) {
  const a = document.createElement('a');
  a.href = href;
  a.download = '';
  document.body.append(a);
  a.click();
  a.remove();
}

/** One removable chip per active advanced filter. */
function activeChips(
  value: AdvancedFilters,
  facets: {forms: {id: string; title: string}[]} | undefined,
  onChange: (patch: Partial<AdvancedFilters>) => void
): {key: string; label: string; remove: () => void}[] {
  if (!advancedCount(value)) return [];
  const formTitle = (id: string) => facets?.forms.find(f => f.id === id)?.title ?? 'Form';
  const chips: {key: string; label: string; remove: () => void}[] = [];
  for (const id of value.form) chips.push({key: `f:${id}`, label: `Form: ${formTitle(id)}`, remove: () => onChange({form: value.form.filter(x => x !== id)})});
  for (const c of value.country)
    chips.push({key: `c:${c}`, label: `Country: ${countryLabel(c)}`, remove: () => onChange({country: value.country.filter(x => x !== c)})});
  for (const h of value.has) chips.push({key: `h:${h}`, label: `Has ${HAS_LABEL[h].toLowerCase()}`, remove: () => onChange({has: value.has.filter(x => x !== h)})});
  const range = dateRangeLabel(value.from, value.to);
  if (range) chips.push({key: 'date', label: `Last active ${range}`, remove: () => onChange({from: undefined, to: undefined})});
  const count = countRangeLabel(value.min, value.max);
  if (count) chips.push({key: 'count', label: count, remove: () => onChange({min: undefined, max: undefined})});
  return chips;
}

