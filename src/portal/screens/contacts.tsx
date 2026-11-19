import {useQuery} from '@tanstack/react-query';
import {Link} from '@tanstack/react-router';
import {useCallback, useEffect, useRef, useState} from 'react';

import {
  CONTACT_SEGMENT_LABEL,
  CONTACT_SEGMENTS,
  CONTACT_SORT_LABEL,
  CONTACT_SORTS,
  CONTACTS_PAGE_SIZES,
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
import {Pager, type PageTarget} from '../intelform/lib/Pager';
import {useCan} from '../intelform/lib/can';
import {useExport} from '../intelform/lib/exports';
import {
  type AdvancedFilters,
  advancedCount,
  clearFilters,
  type ContactsState,
  contactsExportQuery,
  contactsListQuery,
  contactsOverviewQuery,
  DEFAULT_CONTACTS_STATE,
  defaultDir,
  isFiltered,
  rememberContactsSize,
  rememberedContactsSize,
  useDeleteContacts,
} from '../intelform/queries/contacts';
import {FIRST_PAGE, type PageNav} from '../intelform/queries/responses';
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
  // Erasing deletes the contact's responses, so the server asks for both.
  const canEditContacts = useCan('editContacts');
  const canDeleteResponses = useCan('deleteResponses');
  const canDelete = canEditContacts && canDeleteResponses;
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

  // Numbered keyset pages with a rows-per-page choice: the same pager as the responses table.
  const [size, setSize] = useState(rememberedContactsSize);
  const [nav, setNav] = useState<PageNav>(FIRST_PAGE);
  const [via, setVia] = useState<PageTarget | null>(null);
  const topRef = useRef<HTMLDivElement>(null);

  // Selection is cleared, and the list goes back to page 1, whenever the filters or sort change.
  const [selected, setSelected] = useState<Map<string, ContactRow>>(() => new Map());
  const stateSig = JSON.stringify(state);
  const [selectionSig, setSelectionSig] = useState(stateSig);
  if (stateSig !== selectionSig) {
    setSelectionSig(stateSig);
    setSelected(new Map());
    setNav(FIRST_PAGE);
  }

  const list = useQuery(contactsListQuery(state, size, nav));
  const overview = useQuery(contactsOverviewQuery);
  const strip = overview.data?.strip;
  const facets = overview.data?.facets;
  const exporter = useExport();
  // Starting an export needs its own permission (the store's read-only demo has none).
  const canExport = useCan('exportResponses');
  const data = list.data;
  const rows = data?.contacts;
  const settled = !!data && !list.isPlaceholderData;

  // A page that came back empty or out of step (contacts deleted meanwhile): back to page 1.
  useEffect(() => {
    if (!settled || !data || nav.page === 1) return;
    if (data.contacts.length === 0 || (nav.before && !data.prevCursor)) setNav(FIRST_PAGE);
  }, [settled, data, nav]);

  const page = nav.page;
  const lastPage = !data || data.totalCapped ? null : Math.max(1, Math.ceil(data.total / size));
  const pending = list.isPlaceholderData ? via : null;
  const go = (to: PageTarget) => {
    if (!data) return;
    let next: PageNav;
    if (to === 'first' || (to === 'prev' && (page <= 2 || !data.prevCursor))) next = FIRST_PAGE;
    else if (to === 'prev') next = {page: page - 1, before: data.prevCursor!};
    else if (to === 'next') {
      if (!data.nextCursor) return;
      next = {page: page + 1, cursor: data.nextCursor};
    } else {
      if (lastPage === null) return;
      next = lastPage === 1 ? FIRST_PAGE : {page: lastPage, last: data.total - (lastPage - 1) * size};
    }
    setVia(to);
    setNav(next);
    // Back to the top of the table when the pager was clicked below it.
    const top = topRef.current;
    if (top && top.getBoundingClientRect().top < 0) top.scrollIntoView({block: 'start'});
  };
  const changeSize = (n: number) => {
    setSize(n);
    setNav(FIRST_PAGE);
    rememberContactsSize(n);
  };
  const fromRow = rows?.length ? (page - 1) * size + 1 : 0;
  const toRow = (page - 1) * size + (rows?.length ?? 0);
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

  const exportKeys = useCallback(
    (keys: string[]) => void exporter.run({kind: 'contacts', query: contactsExportQuery(state, keys)}),
    [exporter, state]
  );

  const askDelete = (target: DeleteTarget) => {
    const one = target.keys.length === 1;
    const responses = target.responses === 1 ? 'the 1 response' : `all ${plural(target.responses, 'response')}`;
    void confirm({
      title: one ? `Delete ${target.name ?? 'this contact'}?` : `Delete ${formatNumber(target.keys.length)} contacts?`,
      body: `This permanently deletes ${responses} from ${one ? 'this contact' : 'these contacts'} across all forms. Form summaries and counts update, exports already made that include them are removed, and it can’t be undone. Copies already sent by email or webhook are outside this app. Download a CSV first if you need a copy.`,
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
        items.push({label: 'Export CSV', icon: 'download', onSelect: () => exportKeys([r.key])});
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
        actions={
          rows && !noContacts ? (
            <Button
              variant="secondary"
              icon="download"
              pending={exporter.pending}
              pendingLabel="Exporting…"
              disabled={!canExport}
              onClick={() => void exporter.run({kind: 'contacts', query: contactsExportQuery(state)})}>
              Export CSV
            </Button>
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
            <div ref={topRef} aria-busy={list.isFetching || undefined} className={list.isPlaceholderData ? 'contacts-stale' : undefined}>
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
          {data && (
            <div className="list-foot">
              <p className="muted list-count" aria-live="polite">
                {data.total > data.contacts.length || page > 1 ? (
                  <>
                    Showing <strong>{formatNumber(fromRow)}–{formatNumber(toRow)}</strong> of{' '}
                  </>
                ) : null}
                {formatNumber(data.total)}
                {data.totalCapped ? '+' : ''} {data.total === 1 && !data.totalCapped ? 'contact' : 'contacts'}
                {filtered && strip && data.total !== strip.total && ` (filtered from ${formatNumber(strip.total)})`}
              </p>
              {((strip?.total ?? data.total) > CONTACTS_PAGE_SIZES[0] || page > 1) && (
                <Pager
                  page={page}
                  lastPage={lastPage}
                  lastPageCapped={data.totalCapped}
                  hasPrev={page > 1}
                  hasNext={!!data.nextCursor}
                  size={size}
                  pending={pending}
                  onGo={go}
                  onSize={changeSize}
                />
              )}
            </div>
          )}

          {selected.size > 0 && (
            <div role="region" aria-label="Selection" className="contacts-bulk">
              <span className="contacts-bulk-count">{formatNumber(selected.size)} selected</span>
              <Button
                variant="secondary"
                size="sm"
                icon="download"
                pending={exporter.pending}
                pendingLabel="Exporting…"
                disabled={!canExport}
                onClick={() => exportKeys([...selected.keys()])}>
                Export CSV
              </Button>
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

        </>
      )}

      <ContactDrawer
        contactKey={openKey}
        onClose={() => setOpenKey(null)}
        onExport={exportKeys}
        exporting={exporter.pending}
        onDelete={
          canDelete
            ? d => askDelete({keys: [d.contact.key], responses: d.contact.responseCount, name: contactTitle(d.contact)})
            : null
        }
      />
    </div>
  );
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

