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
import {CSV_BOM, csvRow} from './csv';
import {contactsCte, filterFragment, orderFragment, platformFileId} from './sql';

/**
 * Contacts: responses grouped by `responses.contact_key`. Every query aggregates responses on the
 * fly (ported from legacy/server/contacts/query.ts onto Prisma's tagged `$queryRaw`).
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

/** Each contact's forms with response counts, most recently answered first. */
async function formsByKey(db: Reader, keys: string[]): Promise<Map<string, FormWithResponses[]>> {
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

// ------------------------------------------------------------------ List, strip, facets

/** Workspace-wide numbers and filter choices, ignoring every filter. */
export async function contactsOverview(db: Reader): Promise<ContactsOverviewResponse> {
  const [[s], countries, forms] = await Promise.all([
    db.$queryRaw<{total: number; new_week: number; returning: number; with_phone: number}[]>`
      WITH ${contactsCte()}
      SELECT count(*)::int AS total,
        count(*) FILTER (WHERE first_seen >= now() - interval '7 days')::int AS new_week,
        count(*) FILTER (WHERE n >= 2)::int AS returning,
        count(*) FILTER (WHERE phone IS NOT NULL)::int AS with_phone
      FROM c
    `,
    db.$queryRaw<{code: string; contacts: number}[]>`
      WITH ${contactsCte()}
      SELECT country AS code, count(*)::int AS contacts
      FROM c WHERE country IS NOT NULL
      GROUP BY country
      ORDER BY contacts DESC, code
      LIMIT 300
    `,
    db.$queryRaw<{id: string; title: string; status: string; contacts: number}[]>`
      SELECT f.id::text AS id, f.title, f.status, count(DISTINCT r.contact_key)::int AS contacts
      FROM responses r JOIN forms f ON f.id = r.form_id
      WHERE r.contact_key IS NOT NULL
      GROUP BY f.id
      ORDER BY contacts DESC, f.title, f.id
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

/** One page of contacts (50) matching the filters, with the matching total. `tz` is already safe. */
export async function listContacts(db: Reader, q: ContactsListQuery, tz: string): Promise<ContactsListResponse> {
  const where = filterFragment(q, tz);
  const offset = (q.page - 1) * CONTACTS_PAGE_SIZE;
  const rows = await db.$queryRaw<(DbContact & {total: number})[]>`
    WITH ${contactsCte()}
    SELECT c.key, c.n, c.first_seen, c.last_seen, c.email, c.name, c.phone, c.country, c.form_count,
      count(*) OVER ()::int AS total
    FROM c WHERE ${where}
    ORDER BY ${orderFragment(q.sort, q.dir)}
    LIMIT ${CONTACTS_PAGE_SIZE} OFFSET ${offset}
  `;
  let total = Number(rows[0]?.total ?? 0);
  if (!rows.length && q.page > 1) {
    // Past the last page: the window count saw no rows, so count separately.
    const [r] = await db.$queryRaw<{total: number}[]>`WITH ${contactsCte()} SELECT count(*)::int AS total FROM c WHERE ${where}`;
    total = Number(r?.total ?? 0);
  }
  const forms = await formsByKey(
    db,
    rows.map(r => r.key)
  );
  return {
    contacts: rows.map(r => toRow(r, forms.get(r.key) ?? [])),
    total,
    page: q.page,
    pageSize: CONTACTS_PAGE_SIZE,
  };
}

// ------------------------------------------------------------------ Detail

export const DETAIL_RESPONSES = 200;

export async function contactDetail(db: Reader, key: string): Promise<ContactDetailResponse | null> {
  const [contacts, forms, responses] = await Promise.all([
    db.$queryRaw<DbContact[]>`
      WITH ${contactsCte(Prisma.sql`contact_key = ${key}`)}
      SELECT key, n, first_seen, last_seen, email, name, phone, country, form_count FROM c LIMIT 1
    `,
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

export interface DeleteContactsResult extends DeleteContactsResponse {
  /** Platform file ids of the deleted responses' signatures, to remove after commit. */
  fileIds: string[];
}

/**
 * Erases contacts: every response they sent, on every form, in one transaction (all or
 * nothing). forms.response_count / last_response_at stay right. The caller removes the
 * signature files (`fileIds`) once this has committed.
 */
export async function deleteContacts(db: Db, keys: string[]): Promise<DeleteContactsResult> {
  const unique = [...new Set(keys)];
  return db.$transaction(async tx => {
    const forms = await tx.$queryRaw<{form_id: string}[]>`
      SELECT DISTINCT form_id::text AS form_id FROM responses WHERE contact_key = ANY(${unique}::text[]) LIMIT 10000
    `;
    if (!forms.length) return {contacts: 0, responses: 0, fileIds: []};
    // Lock every form involved in id order, so two deletes (or a delete and a submit) can't deadlock.
    const locked = await tx.$queryRaw<{id: string}[]>`
      SELECT id::text AS id FROM forms WHERE id = ANY(${forms.map(f => f.form_id)}::uuid[]) ORDER BY id FOR UPDATE
    `;
    // A form deleted meanwhile took its responses with it.
    if (!locked.length) return {contacts: 0, responses: 0, fileIds: []};
    const lockedIds = locked.map(f => f.id);
    // Signature URLs come back as one newline-joined text (raw SQL arrays don't survive every driver).
    const deleted = await tx.$queryRaw<{form_id: string; key: string; urls: string | null}[]>`
      DELETE FROM responses
      WHERE contact_key = ANY(${unique}::text[]) AND form_id = ANY(${lockedIds}::uuid[])
      RETURNING form_id::text AS form_id, contact_key AS key,
        array_to_string(ARRAY(
          SELECT v->>'url' FROM jsonb_each(answers) e(k, v)
          WHERE jsonb_typeof(v) = 'object' AND left(v->>'url', 17) = '/__platform/files'
        ), E'\n') AS urls
    `;
    if (!deleted.length) return {contacts: 0, responses: 0, fileIds: []};
    const perForm = new Map<string, number>();
    const found = new Set<string>();
    const fileIds = new Set<string>();
    for (const r of deleted) {
      perForm.set(r.form_id, (perForm.get(r.form_id) ?? 0) + 1);
      found.add(r.key);
      for (const url of (r.urls ?? '').split('\n')) {
        const id = platformFileId(url);
        if (id) fileIds.add(id);
      }
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
    return {contacts: found.size, responses: deleted.length, fileIds: [...fileIds]};
  });
}

// ------------------------------------------------------------------ CSV

export const CSV_HEADERS = ['Name', 'Email', 'Phone', 'Country', 'Responses', 'Forms', 'First seen', 'Last active'];
/** Contacts per query while streaming the CSV. */
export const CSV_BATCH = 2000;
/** The most contacts one export holds (a Worker request has a CPU budget). */
export const CSV_MAX_ROWS = 100_000;

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

/**
 * The CSV of the filtered contacts (or just `q.key`), BOM and header first, in the list's order,
 * one batch of rows per chunk. `tz` is already safe.
 */
export async function* contactsCsvChunks(
  db: Reader,
  q: ContactsCsvQuery,
  tz: string,
  opts: {aborted?: () => boolean} = {}
): AsyncGenerator<string> {
  const cte = q.key.length ? contactsCte(Prisma.sql`contact_key = ANY(${q.key}::text[])`) : contactsCte();
  const where = q.key.length ? Prisma.sql`true` : filterFragment(q, tz);
  yield CSV_BOM + csvRow(CSV_HEADERS);
  for (let offset = 0; offset < CSV_MAX_ROWS; offset += CSV_BATCH) {
    if (opts.aborted?.()) return;
    const rows = await db.$queryRaw<CsvDbRow[]>`
      WITH ${cte}
      SELECT c.name, c.email, c.phone, c.country, c.n,
        (SELECT string_agg(x.title, '; ' ORDER BY x.last DESC)
         FROM (SELECT f.title, max(r.submitted_at) AS last FROM responses r JOIN forms f ON f.id = r.form_id
               WHERE r.contact_key = c.key GROUP BY f.id, f.title) x) AS forms,
        to_char(c.first_seen AT TIME ZONE ${tz}, 'YYYY-MM-DD HH24:MI:SS') AS first_txt,
        to_char(c.last_seen AT TIME ZONE ${tz}, 'YYYY-MM-DD HH24:MI:SS') AS last_txt
      FROM c WHERE ${where}
      ORDER BY ${orderFragment(q.sort, q.dir)}
      LIMIT ${CSV_BATCH} OFFSET ${offset}
    `;
    if (rows.length) yield rows.map(csvLine).join('');
    if (rows.length < CSV_BATCH) return;
  }
}

export function contactsCsvFilename(today: string): string {
  return `Contacts ${today}.csv`;
}
