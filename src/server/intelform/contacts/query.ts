import {Prisma, type PrismaClient} from '../../../generated/prisma/client';
import {
  CONTACTS_COUNT_CAP,
  CONTACTS_PAGE_SIZE,
  type ContactDetailResponse,
  type ContactFormRef,
  type ContactRow,
  type ContactsCsvQuery,
  type ContactsListQuery,
  type ContactsListResponse,
  type ContactsOverviewResponse,
  type DeleteContactsResponse,
} from '../../../lib/intelform/api-contacts';
import {cache} from '../../../platform/cache';
import {CSV_BOM, csvRow} from '../responses/csv-text';
import {
  cappedCountSql,
  CONTACT_COLUMNS,
  cursorFor,
  decodeContactCursor,
  encodeContactCursor,
  filterFragment,
  pageBeforeSql,
  pageSql,
  type ContactCursor,
} from './sql';

/**
 * Contacts: one row per `responses.contact_key` in the `contacts` table, which triggers on
 * `responses` keep in the same statement as every insert and delete (sql.ts). Lists page by
 * keyset in the chosen sort (one index each); the strip and filter choices are cached.
 * A contact's forms come from `contacts.form_ids` (most recently answered first): the list and
 * the CSV never read responses; the detail counts each form's responses, bounded, by the
 * (contact_key, form_id, submitted_at DESC) index.
 */

type Db = Pick<PrismaClient, '$queryRaw' | '$transaction'>;
type Reader = Pick<PrismaClient, '$queryRaw'>;

type FormStatus = ContactFormRef['status'];

const asStatus = (s: string): FormStatus => (s === 'live' || s === 'closed' ? s : 'draft');
const iso = (d: Date | string) => (d instanceof Date ? d : new Date(d)).toISOString();

interface DbContact {
  key: string;
  n: number;
  first_seen: Date;
  last_seen: Date;
  email: string | null;
  name: string | null;
  phone: string | null;
  country: string | null;
  form_count: number;
}

interface DbFormRef {
  id: string;
  title: string;
  status: string;
}

type FormWithResponses = ContactFormRef & {responses: number};

/** The forms of a list row: its first 3 form ids (most recent first) with titles, as JSON. */
const LIST_FORMS = Prisma.sql`(
  SELECT coalesce(json_agg(json_build_object('id', f.id::text, 'title', f.title, 'status', f.status) ORDER BY u.o), '[]'::json)
  FROM unnest(c.form_ids[1:3]) WITH ORDINALITY AS u(fid, o) JOIN forms f ON f.id = u.fid
)`;

const toRefs = (forms: DbFormRef[] | null): ContactFormRef[] =>
  (forms ?? []).map(f => ({id: f.id, title: f.title, status: asStatus(f.status)}));

/** Per form, responses are counted up to this many (the detail shows "1,000+"). */
export const FORM_COUNT_CAP = 1000;
/** At most this many of a contact's forms on the detail (formCount has the full number). */
export const DETAIL_FORMS = 100;

export function toRow(c: DbContact, forms: ContactFormRef[]): ContactRow {
  return {
    key: c.key,
    email: c.email,
    name: c.name,
    phone: c.phone,
    country: c.country,
    responseCount: Number(c.n),
    forms: forms.slice(0, 3).map(({id, title, status}) => ({id, title, status})),
    formCount: Number(c.form_count),
    firstSeen: iso(c.first_seen),
    lastSeen: iso(c.last_seen),
  };
}

// ------------------------------------------------------------------ Strip and filter choices

/**
 * Site Cache (docs/agent/cache.md):
 *   report:contacts-overview   10 min   the strip and filter choices: workspace-wide, the same for
 *                                       every CONTACT_READ viewer. clearContactsOverview() (contacts
 *                                       erased, a form deleted) drops it; clearContactsOverview('soon')
 *                                       (responses deleted, retention) lets one built under a minute
 *                                       ago live one more minute, so a stream of deletes rebuilds it
 *                                       at most about once a minute (a new response just shows
 *                                       within 10 minutes).
 */
export const OVERVIEW_KEY = 'report:contacts-overview';
const OVERVIEW_TTL = 10 * 60;
/** A rebuild younger than this survives a 'soon' clear (seconds; the cache's minimum TTL). */
const OVERVIEW_MIN_AGE = 60;

interface CachedOverview {
  at: number;
  data: ContactsOverviewResponse;
}

/**
 * 'now': drop the cached overview. 'soon' (after responses were deleted): drop it, unless it was
 * built under a minute ago; then it expires within a minute.
 */
export async function clearContactsOverview(when: 'now' | 'soon' = 'now', now = Date.now()): Promise<void> {
  if (when === 'soon') {
    const cached = await cache.get<CachedOverview>(OVERVIEW_KEY);
    if (!cached) return;
    if (typeof cached.at === 'number' && now - cached.at < OVERVIEW_MIN_AGE * 1000) {
      await cache.set(OVERVIEW_KEY, cached, OVERVIEW_MIN_AGE);
      return;
    }
  }
  await cache.del(OVERVIEW_KEY);
}

/** Workspace-wide numbers and filter choices, ignoring every filter. Cached; ONE pass over contacts on a miss. */
export async function contactsOverview(db: Reader): Promise<ContactsOverviewResponse> {
  const cached = await cache.getOrSet<CachedOverview>(OVERVIEW_KEY, OVERVIEW_TTL, async () => ({at: Date.now(), data: await loadOverview(db)}));
  // A value cached before {at, data} (an older deploy) is rebuilt.
  return cached.data ?? (await loadOverview(db));
}

interface OverviewRow {
  /** 0 the totals, 1 a country, 2 a form. */
  kind: number;
  code: string | null;
  id: string | null;
  title: string | null;
  status: string | null;
  contacts: number;
  new_week: number;
  repeat: number;
  with_phone: number;
}

/**
 * The totals, the contacts per country and per form, in one scan of contacts (grouping sets over
 * each contact's forms; the totals and countries count a contact once, on its first form).
 */
async function loadOverview(db: Reader): Promise<ContactsOverviewResponse> {
  const rows = await db.$queryRaw<OverviewRow[]>`
    WITH g AS (
      SELECT CASE WHEN GROUPING(c.country) = 0 THEN 1 WHEN GROUPING(u.fid) = 0 THEN 2 ELSE 0 END AS kind,
        c.country AS code, u.fid,
        CASE WHEN GROUPING(u.fid) = 0 THEN count(*) ELSE count(*) FILTER (WHERE coalesce(u.o, 1) = 1) END::int AS contacts,
        count(*) FILTER (WHERE coalesce(u.o, 1) = 1 AND c.first_seen >= now() - interval '7 days')::int AS new_week,
        count(*) FILTER (WHERE coalesce(u.o, 1) = 1 AND c.n >= 2)::int AS repeat,
        count(*) FILTER (WHERE coalesce(u.o, 1) = 1 AND c.phone IS NOT NULL)::int AS with_phone
      FROM contacts c LEFT JOIN LATERAL unnest(c.form_ids) WITH ORDINALITY AS u(fid, o) ON true
      GROUP BY GROUPING SETS ((), (c.country), (u.fid))
    ),
    ranked AS (
      SELECT g.*, f.title, f.status,
        row_number() OVER (PARTITION BY g.kind ORDER BY g.contacts DESC, f.title, g.code, g.fid) AS pos
      FROM g LEFT JOIN forms f ON g.kind = 2 AND f.id = g.fid
      WHERE g.kind = 0 OR (g.kind = 1 AND g.code IS NOT NULL) OR (g.kind = 2 AND f.id IS NOT NULL)
    )
    SELECT kind, code, fid::text AS id, title, status, contacts, new_week, repeat, with_phone
    FROM ranked
    WHERE (kind = 1 AND pos <= 300) OR (kind = 2 AND pos <= 1000) OR kind = 0
    ORDER BY kind, pos
  `;
  const s = rows.find(r => Number(r.kind) === 0);
  const countries = rows.filter(r => Number(r.kind) === 1 && r.code);
  const forms = rows.filter(r => Number(r.kind) === 2 && r.id);
  const total = Number(s?.contacts ?? 0);
  const withPhone = Number(s?.with_phone ?? 0);
  const formRefs = forms.map(f => ({id: f.id!, title: f.title ?? '', status: asStatus(f.status ?? ''), contacts: Number(f.contacts)}));
  return {
    strip: {
      total,
      newThisWeek: Number(s?.new_week ?? 0),
      returning: Number(s?.repeat ?? 0),
      withPhonePct: total ? Math.round((withPhone / total) * 100) : 0,
      topForms: formRefs.slice(0, 3),
    },
    facets: {forms: formRefs, countries: countries.map(c => ({code: c.code!, contacts: Number(c.contacts)}))},
  };
}

// ------------------------------------------------------------------ List

/** True when any filter narrows the list (search, segment, forms, countries, details, dates, counts). */
export function contactsFiltered(q: ContactsListQuery): boolean {
  return !!(
    q.q ||
    q.segment !== 'all' ||
    q.form.length ||
    q.country.length ||
    q.has.length ||
    q.from ||
    q.to ||
    q.min !== undefined ||
    q.max !== undefined
  );
}

type ListRow = DbContact & {sort_v: string | null; forms: DbFormRef[] | null};

/**
 * One page of contacts (25, 50 or 100) matching the filters, by keyset in the chosen sort: rows
 * after `cursor`, before `before`, or the last `last` rows (read backwards, then flipped). Each
 * row carries its latest 3 forms (from contacts.form_ids). The page and a total travel together:
 * the total is counted up to CONTACTS_COUNT_CAP + 1 rows (never the whole table); unfiltered and
 * past the cap it is the cached workspace total (the strip's), so "last page" still works.
 */
export async function listContacts(db: Reader, q: ContactsListQuery, tz: string): Promise<ContactsListResponse> {
  const size = q.size ?? CONTACTS_PAGE_SIZE;
  const after = cursorFor(q.sort, decodeContactCursor(q.cursor));
  const before = after ? null : cursorFor(q.sort, decodeContactCursor(q.before));
  const last = after || before || !q.last ? null : Math.min(q.last, size);
  const backwards = !!before || last !== null;
  const want = last ?? size;
  const where = filterFragment(q, tz);
  const columns = Prisma.sql`${CONTACT_COLUMNS}, ${LIST_FORMS} AS forms`;
  const page = backwards ? pageBeforeSql(q.sort, q.dir, where, before, want + 1, columns) : pageSql(q.sort, q.dir, where, after, want + 1, columns);
  const filtered = contactsFiltered(q);
  const [rows, counted] = await Promise.all([
    db.$queryRaw<ListRow[]>`${page}`,
    db.$queryRaw<{n: number}[]>`${cappedCountSql(where, CONTACTS_COUNT_CAP)}`.then(r => Number(r[0]?.n ?? 0)),
  ]);
  const over = counted > CONTACTS_COUNT_CAP;
  // Unfiltered and past the cap: the workspace total from the cached strip (one scan per 10 minutes).
  const total = over && !filtered ? Math.max((await contactsOverview(db)).strip.total, counted) : Math.min(counted, CONTACTS_COUNT_CAP);
  const more = rows.length > want;
  const shown = backwards ? rows.slice(0, want).reverse() : rows.slice(0, want);
  const cursorOf = (r: ListRow | undefined) => (r ? encodeContactCursor({v: r.sort_v, k: r.key}) : null);
  return {
    contacts: shown.map(r => toRow(r, toRefs(r.forms))),
    pageSize: size,
    // Forwards: more rows past this page mean a next one. Backwards: the page we came from (none
    // for the last page) is next, and more rows mean a previous one.
    nextCursor: backwards ? (before ? cursorOf(shown.at(-1)) : null) : more ? cursorOf(shown.at(-1)) : null,
    prevCursor: backwards ? (more ? cursorOf(shown[0]) : null) : after ? cursorOf(shown[0]) : null,
    total,
    totalCapped: over && filtered,
  };
}

// ------------------------------------------------------------------ Detail

export const DETAIL_RESPONSES = 200;

/**
 * One contact, their forms (most recent first, each with its responses counted up to
 * FORM_COUNT_CAP + 1) and their latest responses: per form the newest DETAIL_RESPONSES by index,
 * then the newest of those. Every read is bounded by the contact's forms.
 */
export async function contactDetail(db: Reader, key: string): Promise<ContactDetailResponse | null> {
  const [contacts, forms, responses] = await Promise.all([
    db.$queryRaw<DbContact[]>`SELECT ${CONTACT_COLUMNS} FROM contacts c WHERE c.key = ${key}`,
    db.$queryRaw<(DbFormRef & {responses: number})[]>`
      SELECT f.id::text AS id, f.title, f.status, x.responses
      FROM contacts c
      CROSS JOIN LATERAL unnest(c.form_ids[1:${DETAIL_FORMS}]) WITH ORDINALITY AS u(fid, o)
      JOIN forms f ON f.id = u.fid
      CROSS JOIN LATERAL (
        SELECT count(*)::int AS responses FROM (
          SELECT 1 FROM responses r WHERE r.contact_key = c.key AND r.form_id = u.fid LIMIT ${FORM_COUNT_CAP + 1}
        ) z
      ) x
      WHERE c.key = ${key}
      ORDER BY u.o
    `,
    db.$queryRaw<
      {id: string; submitted_at: Date; duration_ms: number | null; device: string | null; country: string | null; form_id: string; title: string; status: string}[]
    >`
      SELECT r.id::text AS id, r.submitted_at, r.duration_ms, r.device, r.country, f.id::text AS form_id, f.title, f.status
      FROM contacts c
      CROSS JOIN LATERAL unnest(c.form_ids[1:${DETAIL_FORMS}]) AS u(fid)
      CROSS JOIN LATERAL (
        SELECT r.id, r.submitted_at, r.duration_ms, r.device, r.country, r.form_id FROM responses r
        WHERE r.contact_key = c.key AND r.form_id = u.fid
        ORDER BY r.submitted_at DESC, r.id DESC
        LIMIT ${DETAIL_RESPONSES}
      ) r
      JOIN forms f ON f.id = r.form_id
      WHERE c.key = ${key}
      ORDER BY r.submitted_at DESC, r.id DESC
      LIMIT ${DETAIL_RESPONSES}
    `,
  ]);
  const contact = contacts[0];
  if (!contact) return null;
  const list: FormWithResponses[] = forms.map(f => ({id: f.id, title: f.title, status: asStatus(f.status), responses: Number(f.responses)}));
  return {
    contact: toRow(contact, list),
    responses: responses.map(r => ({
      id: r.id,
      form: {id: r.form_id, title: r.title, status: asStatus(r.status)},
      submittedAt: iso(r.submitted_at),
      durationMs: r.duration_ms === null ? null : Number(r.duration_ms),
      device: r.device,
      country: r.country,
    })),
    forms: list,
  };
}

// ------------------------------------------------------------------ Delete

/**
 * Erases contacts: every response they sent, on every form, in ONE statement (all or nothing).
 * The responses delete trigger takes them off each form's counters (form_counts,
 * form_response_hours), refreshes the contacts rows and puts signature files in the file trash;
 * no form row is locked or written (forms.response_count / last_response_at are a copy the
 * every-minute syncFormCounts refreshes). The caller sends the file cleanup job and clears the
 * cached strip.
 */
export async function deleteContacts(db: Db, keys: string[]): Promise<DeleteContactsResponse> {
  const unique = [...new Set(keys)];
  const [row] = await db.$queryRaw<{contacts: number; responses: number}[]>`
    WITH d AS (
      DELETE FROM responses WHERE contact_key = ANY(${unique}::text[])
      RETURNING contact_key
    )
    SELECT count(DISTINCT contact_key)::int AS contacts, count(*)::int AS responses FROM d
  `;
  return {contacts: Number(row?.contacts ?? 0), responses: Number(row?.responses ?? 0)};
}

// ------------------------------------------------------------------ CSV (the export job)

export const CSV_HEADERS = ['Name', 'Email', 'Phone', 'Country', 'Responses', 'Forms', 'First seen', 'Last active'];
/** Contacts per batch of the export job. */
export const CSV_BATCH = 1000;

interface CsvDbRow {
  name: string | null;
  email: string | null;
  phone: string | null;
  country: string | null;
  n: number;
  forms: string | null;
  first_txt: string;
  last_txt: string;
}

export function csvLine(r: CsvDbRow): string {
  return csvRow([r.name, r.email, r.phone, r.country, Number(r.n), r.forms, r.first_txt, r.last_txt]);
}

export function contactsCsvHeader(): string {
  return CSV_BOM + csvRow(CSV_HEADERS);
}

/**
 * One batch of the contacts CSV after `cursor`, in the list's order (or just `q.key`), read by
 * keyset from the contacts table (one index range per batch: the whole export is O(n)); each
 * contact's form titles come from its form_ids (most recent first), never from responses.
 * `tz` is already safe.
 */
export async function contactsCsvBatch(
  db: Reader,
  q: ContactsCsvQuery,
  tz: string,
  cursor: ContactCursor | null
): Promise<{text: string; rows: number; next: ContactCursor | null}> {
  const where = q.key.length ? Prisma.sql`c.key = ANY(${q.key}::text[])` : filterFragment(q, tz);
  const columns = Prisma.sql`c.key, c.name, c.email, c.phone, c.country, c.n,
    (SELECT string_agg(f.title, '; ' ORDER BY u.o) FROM unnest(c.form_ids) WITH ORDINALITY AS u(fid, o) JOIN forms f ON f.id = u.fid) AS forms,
    to_char(c.first_seen AT TIME ZONE ${tz}, 'YYYY-MM-DD HH24:MI:SS') AS first_txt,
    to_char(c.last_seen AT TIME ZONE ${tz}, 'YYYY-MM-DD HH24:MI:SS') AS last_txt`;
  const page = pageSql(q.sort, q.dir, where, cursor, CSV_BATCH, columns);
  const rows = await db.$queryRaw<(CsvDbRow & {key: string; sort_v: string | null})[]>`${page}`;
  const last = rows.at(-1);
  return {
    text: rows.map(csvLine).join(''),
    rows: rows.length,
    next: rows.length === CSV_BATCH && last ? {v: last.sort_v, k: last.key} : null,
  };
}

export function contactsCsvFilename(today: string): string {
  return `Contacts ${today}.csv`;
}
