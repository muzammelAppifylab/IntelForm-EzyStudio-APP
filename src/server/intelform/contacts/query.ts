import {Prisma, type PrismaClient} from '../../../generated/prisma/client';
import {
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
  afterFragment,
  CONTACT_COLUMNS,
  decodeContactCursor,
  encodeContactCursor,
  filterFragment,
  LAST_SEEN_TEXT,
  orderFragment,
  sortValue,
  type ContactCursor,
} from './sql';

/**
 * Contacts: one row per `responses.contact_key` in the `contacts` table, which triggers on
 * `responses` keep in the same statement as every insert and delete (sql.ts). Lists page by
 * keyset in the chosen sort (one index each); the strip and filter choices are cached.
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

interface DbContactForm {
  key: string;
  id: string;
  title: string;
  status: string;
  responses: number;
}

type FormWithResponses = ContactFormRef & {responses: number};

/** Each contact's forms with response counts, most recently answered first (by index, these keys only). */
export async function formsByKey(db: Reader, keys: string[]): Promise<Map<string, FormWithResponses[]>> {
  const out = new Map<string, FormWithResponses[]>();
  if (!keys.length) return out;
  const rows = await db.$queryRaw<DbContactForm[]>`
    SELECT r.contact_key AS key, f.id::text AS id, f.title, f.status, count(*)::int AS responses
    FROM responses r JOIN forms f ON f.id = r.form_id
    WHERE r.contact_key = ANY(${keys}::text[])
    GROUP BY r.contact_key, f.id
    ORDER BY r.contact_key, max(r.submitted_at) DESC, f.id
    LIMIT 10000
  `;
  for (const r of rows) {
    const list = out.get(r.key) ?? [];
    list.push({id: r.id, title: r.title, status: asStatus(r.status), responses: Number(r.responses)});
    out.set(r.key, list);
  }
  return out;
}

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
 *                                       every CONTACT_READ viewer; cleared when contacts are erased
 *                                       (a new response just shows within 10 minutes)
 */
export const OVERVIEW_KEY = 'report:contacts-overview';
const OVERVIEW_TTL = 10 * 60;

export async function clearContactsOverview(): Promise<void> {
  await cache.del(OVERVIEW_KEY);
}

/** Workspace-wide numbers and filter choices, ignoring every filter. Cached; three reads on a miss, together. */
export async function contactsOverview(db: Reader): Promise<ContactsOverviewResponse> {
  return cache.getOrSet(OVERVIEW_KEY, OVERVIEW_TTL, () => loadOverview(db));
}

async function loadOverview(db: Reader): Promise<ContactsOverviewResponse> {
  const [[s], countries, forms] = await Promise.all([
    db.$queryRaw<{total: number; new_week: number; returning: number; with_phone: number}[]>`
      SELECT count(*)::int AS total,
        count(*) FILTER (WHERE first_seen >= now() - interval '7 days')::int AS new_week,
        count(*) FILTER (WHERE n >= 2)::int AS returning,
        count(*) FILTER (WHERE phone IS NOT NULL)::int AS with_phone
      FROM contacts
    `,
    db.$queryRaw<{code: string; contacts: number}[]>`
      SELECT country AS code, count(*)::int AS contacts
      FROM contacts WHERE country IS NOT NULL
      GROUP BY country
      ORDER BY contacts DESC, code
      LIMIT 300
    `,
    db.$queryRaw<{id: string; title: string; status: string; contacts: number}[]>`
      SELECT f.id::text AS id, f.title, f.status, x.contacts
      FROM (SELECT fid, count(*)::int AS contacts FROM contacts, unnest(form_ids) AS fid GROUP BY fid) x
      JOIN forms f ON f.id = x.fid
      ORDER BY x.contacts DESC, f.title, f.id
      LIMIT 1000
    `,
  ]);
  const total = Number(s?.total ?? 0);
  const withPhone = Number(s?.with_phone ?? 0);
  const formRefs = forms.map(f => ({id: f.id, title: f.title, status: asStatus(f.status), contacts: Number(f.contacts)}));
  return {
    strip: {
      total,
      newThisWeek: Number(s?.new_week ?? 0),
      returning: Number(s?.returning ?? 0),
      withPhonePct: total ? Math.round((withPhone / total) * 100) : 0,
      topForms: formRefs.slice(0, 3),
    },
    facets: {forms: formRefs, countries: countries.map(c => ({code: c.code, contacts: Number(c.contacts)}))},
  };
}

// ------------------------------------------------------------------ List

/**
 * One page of contacts (50) matching the filters, by keyset in the chosen sort: the page and
 * its contacts' forms, two reads. No total (no count per request): `nextCursor` says there is more.
 */
export async function listContacts(db: Reader, q: ContactsListQuery, tz: string): Promise<ContactsListResponse> {
  const cursor = decodeContactCursor(q.cursor);
  const where = filterFragment(q, tz);
  const after = cursor ? afterFragment(q.sort, q.dir, cursor) : Prisma.sql`true`;
  const rows = await db.$queryRaw<(DbContact & {sort_v: string | null; sort_t: string})[]>`
    SELECT ${CONTACT_COLUMNS}, ${sortValue(q.sort)} AS sort_v, ${LAST_SEEN_TEXT} AS sort_t
    FROM contacts c WHERE ${where} AND ${after}
    ORDER BY ${orderFragment(q.sort, q.dir)}
    LIMIT ${CONTACTS_PAGE_SIZE + 1}
  `;
  const page = rows.slice(0, CONTACTS_PAGE_SIZE);
  const forms = await formsByKey(
    db,
    page.map(r => r.key)
  );
  const last = page.at(-1);
  return {
    contacts: page.map(r => toRow(r, forms.get(r.key) ?? [])),
    pageSize: CONTACTS_PAGE_SIZE,
    nextCursor: rows.length > CONTACTS_PAGE_SIZE && last ? encodeContactCursor({v: last.sort_v, t: last.sort_t, k: last.key}) : null,
  };
}

// ------------------------------------------------------------------ Detail

export const DETAIL_RESPONSES = 200;

export async function contactDetail(db: Reader, key: string): Promise<ContactDetailResponse | null> {
  const [contacts, forms, responses] = await Promise.all([
    db.$queryRaw<DbContact[]>`SELECT ${CONTACT_COLUMNS} FROM contacts c WHERE c.key = ${key}`,
    formsByKey(db, [key]),
    db.$queryRaw<
      {id: string; submitted_at: Date; duration_ms: number | null; device: string | null; country: string | null; form_id: string; title: string; status: string}[]
    >`
      SELECT r.id::text AS id, r.submitted_at, r.duration_ms, r.device, r.country, f.id::text AS form_id, f.title, f.status
      FROM responses r JOIN forms f ON f.id = r.form_id
      WHERE r.contact_key = ${key}
      ORDER BY r.submitted_at DESC, r.id DESC
      LIMIT ${DETAIL_RESPONSES}
    `,
  ]);
  const contact = contacts[0];
  if (!contact) return null;
  const list = forms.get(key) ?? [];
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
 * Erases contacts: every response they sent, on every form, in one transaction (all or
 * nothing). forms.response_count / last_response_at stay right; the contacts rows and the
 * signature files' trash entries follow from the responses delete trigger. The caller sends
 * the file cleanup job and clears the cached strip.
 */
export async function deleteContacts(db: Db, keys: string[]): Promise<DeleteContactsResponse> {
  const unique = [...new Set(keys)];
  return db.$transaction(async tx => {
    const forms = await tx.$queryRaw<{form_id: string}[]>`
      SELECT DISTINCT form_id::text AS form_id FROM responses WHERE contact_key = ANY(${unique}::text[]) LIMIT 10000
    `;
    if (!forms.length) return {contacts: 0, responses: 0};
    // Lock every form involved in id order, so two deletes (or a delete and a submit) can't deadlock.
    const locked = await tx.$queryRaw<{id: string}[]>`
      SELECT id::text AS id FROM forms WHERE id = ANY(${forms.map(f => f.form_id)}::uuid[]) ORDER BY id FOR UPDATE
    `;
    // A form deleted meanwhile took its responses with it.
    if (!locked.length) return {contacts: 0, responses: 0};
    const lockedIds = locked.map(f => f.id);
    const deleted = await tx.$queryRaw<{form_id: string; key: string}[]>`
      DELETE FROM responses
      WHERE contact_key = ANY(${unique}::text[]) AND form_id = ANY(${lockedIds}::uuid[])
      RETURNING form_id::text AS form_id, contact_key AS key
    `;
    if (!deleted.length) return {contacts: 0, responses: 0};
    const perForm = new Map<string, number>();
    const found = new Set<string>();
    for (const r of deleted) {
      perForm.set(r.form_id, (perForm.get(r.form_id) ?? 0) + 1);
      found.add(r.key);
    }
    const ids = [...perForm.keys()];
    const counts = ids.map(id => perForm.get(id)!);
    // Exact under the row locks (submits take them too); max() reads one index entry per form.
    await tx.$executeRaw`
      UPDATE forms f SET
        response_count = GREATEST(0, f.response_count - d.n),
        last_response_at = (SELECT max(r.submitted_at) FROM responses r WHERE r.form_id = f.id)
      FROM unnest(${ids}::uuid[], ${counts}::int[]) AS d(id, n)
      WHERE f.id = d.id
    `;
    return {contacts: found.size, responses: deleted.length};
  });
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
 * keyset from the contacts table; every contact's form titles come from ONE joined query for
 * the batch. `tz` is already safe.
 */
export async function contactsCsvBatch(
  db: Reader,
  q: ContactsCsvQuery,
  tz: string,
  cursor: ContactCursor | null
): Promise<{text: string; rows: number; next: ContactCursor | null}> {
  const where = q.key.length ? Prisma.sql`c.key = ANY(${q.key}::text[])` : filterFragment(q, tz);
  const after = cursor ? afterFragment(q.sort, q.dir, cursor) : Prisma.sql`true`;
  const rows = await db.$queryRaw<(CsvDbRow & {key: string; sort_v: string | null; sort_t: string})[]>`
    WITH page AS (
      SELECT c.key, c.name, c.email, c.phone, c.country, c.n, c.first_seen, c.last_seen, ${sortValue(q.sort)} AS sort_v,
        ${LAST_SEEN_TEXT} AS sort_t,
        row_number() OVER (ORDER BY ${orderFragment(q.sort, q.dir)}) AS pos
      FROM contacts c WHERE ${where} AND ${after}
      ORDER BY ${orderFragment(q.sort, q.dir)}
      LIMIT ${CSV_BATCH}
    ),
    titles AS (
      SELECT x.key, string_agg(x.title, '; ' ORDER BY x.last DESC) AS forms
      FROM (
        SELECT r.contact_key AS key, f.title, max(r.submitted_at) AS last
        FROM responses r JOIN forms f ON f.id = r.form_id
        WHERE r.contact_key IN (SELECT key FROM page)
        GROUP BY r.contact_key, f.id, f.title
      ) x
      GROUP BY x.key
    )
    SELECT p.key, p.sort_v, p.sort_t, p.name, p.email, p.phone, p.country, p.n, t.forms,
      to_char(p.first_seen AT TIME ZONE ${tz}, 'YYYY-MM-DD HH24:MI:SS') AS first_txt,
      to_char(p.last_seen AT TIME ZONE ${tz}, 'YYYY-MM-DD HH24:MI:SS') AS last_txt
    FROM page p LEFT JOIN titles t ON t.key = p.key
    ORDER BY p.pos
  `;
  const last = rows.at(-1);
  return {
    text: rows.map(csvLine).join(''),
    rows: rows.length,
    next: rows.length === CSV_BATCH && last ? {v: last.sort_v, t: last.sort_t, k: last.key} : null,
  };
}

export function contactsCsvFilename(today: string): string {
  return `Contacts ${today}.csv`;
}
