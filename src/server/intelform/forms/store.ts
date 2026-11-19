import {Prisma, type PrismaClient} from '../../../generated/prisma/client';
import type {
  CreatedForm,
  FormListItem,
  FormPatchResponse,
  FormsStrip,
  FormStatus,
  FormStatusResponse,
  PublishResponse,
} from '../../../lib/intelform/api-forms';
import {formDefinition, type FormDefinition, type Layout} from '../../../lib/intelform/form/definition';
import {lintLogic, lintOnePerEmail} from '../../../lib/intelform/form/logic';
import {clientSettings, type FormSettings, type FormSettingsPatch} from '../../../lib/intelform/form/settings';
import {defaultTheme, themePreset, type FormTheme} from '../../../lib/intelform/form/theme';
import {cache} from '../../../platform/cache';
import {getAppSettings} from '../settings/settings';
import {writeCatalogAtPublish} from '../responses/catalog';
import {exactResponsesSql} from './counts';
import {
  completionRate,
  countFields,
  encodeCursor,
  FormsError,
  isUuid,
  likePattern,
  mergeSettings,
  notFound,
  PAGE_SIZE,
  randomSlug,
  readSettings,
  readTheme,
  slugTakenError,
  statusAfterSettings,
  zodFields,
  type ListCursor,
  type ListQuery,
} from './core';

/**
 * The forms API's database reads and writes (Prisma, tagged `$queryRaw` only). Each takes the
 * request's client (`c.var.db`) or a transaction client.
 */

type Db = PrismaClient | Prisma.TransactionClient;

const json = (v: unknown) => JSON.stringify(v);

// ---------------------------------------------------------------------------
// App defaults for a new form
// ---------------------------------------------------------------------------

/**
 * App settings for a new form: "Default theme for new forms" (a built-in preset id or a saved
 * theme's uuid; a deleted theme falls back to the built-in default) and the default timezone.
 */
export async function newFormDefaults(db: Db): Promise<{theme: FormTheme; timezone: string}> {
  const row = await db.intelformSettings.findUnique({where: {id: 1}, select: {timezone: true, defaultThemeId: true}});
  const timezone = row?.timezone || 'UTC';
  let theme = defaultTheme();
  const themeId = row?.defaultThemeId;
  if (themeId) {
    const preset = themePreset(themeId);
    if (preset) theme = structuredClone(preset.theme);
    else if (isUuid(themeId)) {
      const saved = await db.theme.findUnique({where: {id: themeId}, select: {settings: true}});
      if (saved) theme = readTheme(saved.settings);
    }
  }
  return {theme, timezone};
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

/**
 * Inserts a draft form with a fresh random 8-character slug, retrying on the (rare) collision
 * with a current slug or an old one that still redirects. One statement per attempt.
 */
export async function insertForm(
  db: Db,
  values: {title: string; draft: FormDefinition; theme: FormTheme; settings: FormSettings; userId: number}
): Promise<CreatedForm> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const slug = randomSlug();
    const rows = await db.$queryRaw<CreatedForm[]>`
      INSERT INTO forms (slug, title, status, draft, theme, settings, created_by, updated_by)
      SELECT ${slug}, ${values.title}, 'draft', ${json(values.draft)}::jsonb, ${json(values.theme)}::jsonb,
        ${json(values.settings)}::jsonb, ${values.userId}, ${values.userId}
      WHERE NOT EXISTS (SELECT 1 FROM form_slugs_old WHERE slug = ${slug})
      ON CONFLICT (slug) DO NOTHING
      RETURNING id::text AS id, slug, title
    `;
    if (rows[0]) return rows[0];
  }
  throw new FormsError(500, 'slug_exhausted', 'Couldn’t create a unique link. Try again.');
}

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

type ListRow = {
  id: string;
  title: string;
  slug: string;
  status: FormStatus;
  layout: Layout;
  responseCount: number;
  starts: number;
  newThisWeek: number;
  hasUnpublished: boolean;
  createdAt: Date;
  updatedAt: Date;
};

/** Sort order per sort key; each ends on id so pages never repeat or skip a tie. Fixed SQL only. */
const ORDER = {
  updated: Prisma.sql`f.updated_at DESC, f.id DESC`,
  created: Prisma.sql`f.created_at DESC, f.id DESC`,
  title: Prisma.sql`lower(f.title) ASC, f.id ASC`,
  responses: Prisma.sql`f.response_count DESC, f.updated_at DESC, f.id DESC`,
} as const;

/** The same orders reversed (every direction flipped): the previous and last pages read backwards. */
const ORDER_BACK = {
  updated: Prisma.sql`f.updated_at ASC, f.id ASC`,
  created: Prisma.sql`f.created_at ASC, f.id ASC`,
  title: Prisma.sql`lower(f.title) DESC, f.id DESC`,
  responses: Prisma.sql`f.response_count ASC, f.updated_at ASC, f.id ASC`,
} as const;

/** Rows before `cursor` in the list's order (the mirror of `after`). */
function before(cursor: ListCursor | null): Prisma.Sql {
  if (!cursor) return Prisma.sql`true`;
  switch (cursor.sort) {
    case 'updated':
      return Prisma.sql`(f.updated_at, f.id) > (${cursor.at}::timestamptz, ${cursor.id}::uuid)`;
    case 'created':
      return Prisma.sql`(f.created_at, f.id) > (${cursor.at}::timestamptz, ${cursor.id}::uuid)`;
    case 'title':
      return Prisma.sql`(lower(f.title), f.id) < (${cursor.title}::text, ${cursor.id}::uuid)`;
    case 'responses':
      return Prisma.sql`(f.response_count, f.updated_at, f.id) > (${cursor.count}::int, ${cursor.at}::timestamptz, ${cursor.id}::uuid)`;
  }
}

function after(cursor: ListCursor | null): Prisma.Sql {
  if (!cursor) return Prisma.sql`true`;
  switch (cursor.sort) {
    case 'updated':
      return Prisma.sql`(f.updated_at, f.id) < (${cursor.at}::timestamptz, ${cursor.id}::uuid)`;
    case 'created':
      return Prisma.sql`(f.created_at, f.id) < (${cursor.at}::timestamptz, ${cursor.id}::uuid)`;
    case 'title':
      return Prisma.sql`(lower(f.title), f.id) > (${cursor.title}::text, ${cursor.id}::uuid)`;
    case 'responses':
      return Prisma.sql`(f.response_count, f.updated_at, f.id) < (${cursor.count}::int, ${cursor.at}::timestamptz, ${cursor.id}::uuid)`;
  }
}

export interface ListPage {
  forms: FormListItem[];
  total: number;
  matched: number;
  page: number;
  pageSize: number;
  nextCursor: string | null;
  prevCursor: string | null;
}

/**
 * One page of forms (keyset), with all-time starts and this week's responses for that page
 * only, plus how many forms exist and match. Two statements, sent together.
 *
 * Counting `forms` is a deliberate exception to "no count() per request": it is a workspace's
 * own forms (tens to hundreds of rows, created by hand), and the UI needs "no results" vs
 * "no forms yet".
 */
export async function listForms(db: Db, query: ListQuery, cursor: ListCursor | null, prev: ListCursor | null = null): Promise<ListPage> {
  const size = query.size ?? PAGE_SIZE;
  const last = cursor || prev || !query.last ? null : Math.min(query.last, size);
  // Backwards (previous page, last page): read in the reverse order, then flip.
  const backwards = !cursor && (!!prev || last !== null);
  const want = last ?? size;
  const matches = Prisma.sql`true
    ${query.status !== 'all' ? Prisma.sql`AND f.status = ${query.status}` : Prisma.empty}
    ${query.q ? Prisma.sql`AND f.title ILIKE ${likePattern(query.q)}` : Prisma.empty}`;
  const order = ORDER[query.sort];
  const pageOrder = backwards ? ORDER_BACK[query.sort] : order;
  const startAt = backwards ? before(prev) : after(cursor);

  // All-time counts from the copy on forms (refreshed every minute by syncFormCounts: the list,
  // its sort and its keyset cursor all read the same indexed column, so a page never shifts),
  // and this week's responses from form_response_hours (at most 168 hours x 16 shards per form
  // by its primary key prefix form_id, hour), never a count of responses.
  const [rows, counts] = await Promise.all([
    db.$queryRaw<ListRow[]>`
      WITH paged AS (
        SELECT f.id, f.title, f.slug, f.status, f.draft->>'layout' AS layout, f.response_count,
          f.has_unpublished, f.published_version_id, f.created_at, f.updated_at, f.starts_total
        FROM forms f
        WHERE ${matches} AND ${startAt}
        ORDER BY ${pageOrder}
        LIMIT ${want + 1}
      )
      SELECT f.id::text AS id, f.title, f.slug, f.status,
        COALESCE(f.layout, 'all_at_once') AS layout,
        f.response_count AS "responseCount",
        f.starts_total AS starts,
        w.n AS "newThisWeek",
        (f.has_unpublished AND f.published_version_id IS NOT NULL) AS "hasUnpublished",
        f.created_at AS "createdAt", f.updated_at AS "updatedAt"
      FROM paged f
      CROSS JOIN LATERAL (
        SELECT GREATEST(COALESCE(sum(n), 0), 0)::int AS n FROM form_response_hours
        WHERE form_id = f.id AND hour >= date_trunc('hour', now()) - interval '7 days'
      ) w
      ORDER BY ${pageOrder}
    `,
    db.$queryRaw<{total: number; matched: number}[]>`
      SELECT count(*)::int AS total, count(*) FILTER (WHERE ${matches})::int AS matched FROM forms f
    `,
  ]);

  const page = query.page ?? (cursor ? cursor.page + 1 : 1);
  const more = rows.length > want;
  const shown = backwards ? rows.slice(0, want).reverse() : rows.slice(0, want);
  const cursorOf = (r: ListRow | undefined) => (r ? encodeCursor(query.sort, page, r) : null);
  return {
    forms: shown.map(r => ({
      id: r.id,
      title: r.title,
      slug: r.slug,
      status: r.status,
      layout: r.layout,
      responseCount: r.responseCount,
      completionRate: completionRate(r.responseCount, r.starts),
      hasUnpublished: r.hasUnpublished,
      newThisWeek: r.newThisWeek,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    })),
    total: counts[0]?.total ?? 0,
    matched: counts[0]?.matched ?? 0,
    page,
    pageSize: size,
    // Forwards: more rows past this page mean a next one. Backwards: the page we came from (none
    // for the last page) is next, and more rows mean a previous one.
    nextCursor: backwards ? (prev ? cursorOf(shown.at(-1)) : null) : more ? cursorOf(shown.at(-1)) : null,
    prevCursor: backwards ? (more ? cursorOf(shown[0]) : null) : cursor ? cursorOf(shown[0]) : null,
  };
}

// ---------------------------------------------------------------------------
// The weekly strip
// ---------------------------------------------------------------------------

/**
 * Site Cache (docs/agent/cache.md):
 *   report:forms-strip   5 min   the dashboard's weekly strip: workspace-wide, the same for every
 *                                FORM_READ viewer, built only from counters kept on write (time-based;
 *                                also cleared when a form is deleted)
 */
export const FORMS_STRIP_KEY = 'report:forms-strip';
const FORMS_STRIP_TTL = 5 * 60;

export async function clearFormsStrip(): Promise<void> {
  await cache.del(FORMS_STRIP_KEY);
}

/** The weekly strip above the list: workspace-wide, so it ignores search, filter and paging. Cached. */
export async function formsStrip(db: Db): Promise<FormsStrip> {
  return cache.getOrSet(FORMS_STRIP_KEY, FORMS_STRIP_TTL, () => loadFormsStrip(db as PrismaClient));
}

/** The calendar day of an hour bucket in `timezone` (YYYY-MM-DD). */
export function localDay(hour: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit'}).format(hour);
}

/**
 * Every read in ONE round trip, from counters kept on write: forms.response_count and
 * starts_total (the copy syncFormCounts refreshes every minute: fine for a 5-minute cached strip),
 * and form_response_hours (responses per form per hour in 16 shards, kept by the responses
 * triggers; sums are clamped at 0, as a shard may be negative after deletes), never the responses
 * or form_event_counts tables. The app's time zone comes from
 * the cached app settings; the last 8 days of hourly counts are put into local days here.
 */
export async function loadFormsStrip(db: PrismaClient): Promise<FormsStrip> {
  type Counts = {all: number; live: number; draft: number; closed: number; avg_completion: number | null};
  type MostActive = {id: string; title: string; status: FormStatus; count: number; responses: number; starts: number};
  const [settings, [counts], [week], mostActive, hours] = await Promise.all([
    getAppSettings(db),
    // A workspace's own forms (tens to hundreds of rows, made by hand).
    db.$queryRaw<Counts[]>`
      SELECT count(*)::int AS "all",
        count(*) FILTER (WHERE status = 'live')::int AS live,
        count(*) FILTER (WHERE status = 'draft')::int AS draft,
        count(*) FILTER (WHERE status = 'closed')::int AS closed,
        (avg(LEAST(1, response_count::float8 / starts_total)) FILTER (WHERE starts_total > 0))::float8 AS avg_completion
      FROM forms
    `,
    db.$queryRaw<{this_week: number; last_week: number}[]>`
      SELECT GREATEST(coalesce(sum(n) FILTER (WHERE hour >= date_trunc('hour', now()) - interval '7 days'), 0), 0)::int AS this_week,
        GREATEST(coalesce(sum(n) FILTER (WHERE hour < date_trunc('hour', now()) - interval '7 days'), 0), 0)::int AS last_week
      FROM form_response_hours WHERE hour >= date_trunc('hour', now()) - interval '14 days'
    `,
    db.$queryRaw<MostActive[]>`
      SELECT f.id::text AS id, f.title, f.status, top.count, f.response_count AS responses, f.starts_total AS starts
      FROM (
        SELECT form_id, sum(n)::int AS count FROM form_response_hours
        WHERE hour >= date_trunc('hour', now()) - interval '7 days'
        GROUP BY form_id HAVING sum(n) > 0
      ) top
      JOIN forms f ON f.id = top.form_id
      ORDER BY top.count DESC, f.title
      LIMIT 3
    `,
    db.$queryRaw<{hour: Date; n: number}[]>`
      SELECT hour, GREATEST(sum(n), 0)::int AS n FROM form_response_hours
      WHERE hour >= now() - interval '9 days'
      GROUP BY hour
    `,
  ]);

  // Calendar days in the app's timezone, today last.
  const timezone = settings.timezone || 'UTC';
  let tz = timezone;
  try {
    localDay(new Date(), tz);
  } catch {
    tz = 'UTC';
  }
  const today = localDay(new Date(), tz);
  const dayList: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(`${today}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - i);
    dayList.push(d.toISOString().slice(0, 10));
  }
  const byDay = new Map(dayList.map(d => [d, 0]));
  for (const h of hours) {
    const day = localDay(h.hour instanceof Date ? h.hour : new Date(h.hour), tz);
    if (byDay.has(day)) byDay.set(day, byDay.get(day)! + Number(h.n));
  }

  return {
    responsesThisWeek: week?.this_week ?? 0,
    responsesLastWeek: week?.last_week ?? 0,
    mostActive: mostActive.map(f => ({
      id: f.id,
      title: f.title,
      count: f.count,
      status: f.status,
      completionRate: completionRate(f.responses, f.starts),
    })),
    days: dayList.map(date => ({date, count: byDay.get(date) ?? 0})),
    counts: {all: counts?.all ?? 0, live: counts?.live ?? 0, draft: counts?.draft ?? 0, closed: counts?.closed ?? 0},
    avgCompletion: counts?.avg_completion ?? null,
  };
}

// ---------------------------------------------------------------------------
// Slugs
// ---------------------------------------------------------------------------

/** Is `slug` another form's current link, or an old link that still redirects to another form? */
export async function slugTaken(db: Db, slug: string, formId: string): Promise<boolean> {
  const rows = await db.$queryRaw<{one: number}[]>`
    SELECT 1 AS one FROM forms WHERE slug = ${slug} AND id <> ${formId}::uuid
    UNION ALL
    SELECT 1 FROM form_slugs_old WHERE slug = ${slug} AND form_id <> ${formId}::uuid
    LIMIT 1
  `;
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// Autosave (last save wins)
// ---------------------------------------------------------------------------

export interface FormChange {
  /** The If-Match revision, or null for no check. */
  expected: number | null;
  title?: string;
  slug?: string;
  /** Already validated (normalizeDraft / parseTheme). */
  draft?: FormDefinition;
  theme?: FormTheme;
  /** Present when the request sent `settings` at all. */
  settings?: {patch: Omit<FormSettingsPatch, 'password'>; password: {set: false} | {set: true; hash: string | null}};
}

/**
 * Saves a dashboard patch in one short transaction: locks the row, moves the old link to
 * form_slugs_old, merges settings, bumps the revision and says whose save it replaced.
 */
export async function saveForm(db: PrismaClient, id: string, userId: number, change: FormChange): Promise<FormPatchResponse> {
  return db.$transaction(tx => saveFormIn(tx, id, userId, change));
}

/** `saveForm` inside a transaction the caller opened. */
export async function saveFormIn(tx: Db, id: string, userId: number, change: FormChange): Promise<FormPatchResponse> {
  // Locks the row; reads only what the patch needs (no draft, theme or webhook secret).
  type Locked = {
    title: string;
    slug: string;
    status: FormStatus;
    settings: unknown;
    revision: number;
    updated_by: number | null;
    published_version_id: string | null;
  };
  const [row] = await tx.$queryRaw<Locked[]>`
    SELECT title, slug, status, settings, revision, updated_by, published_version_id::text AS published_version_id
    FROM forms WHERE id = ${id}::uuid FOR UPDATE
  `;
  if (!row) throw notFound();

  const overwrote = change.expected !== null && change.expected !== row.revision;
  const overwrittenBy =
    overwrote && row.updated_by !== null ? await tx.user.findUnique({where: {id: row.updated_by}, select: {id: true, name: true}}) : null;

  let slug = row.slug;
  if (change.slug !== undefined && change.slug !== row.slug) {
    if (await slugTaken(tx, change.slug, id)) throw slugTakenError();
    // Taking back its own old link: that link stops being "old".
    await tx.$executeRaw`DELETE FROM form_slugs_old WHERE slug = ${change.slug} AND form_id = ${id}::uuid`;
    await tx.$executeRaw`
      INSERT INTO form_slugs_old (slug, form_id) VALUES (${row.slug}, ${id}::uuid) ON CONFLICT (slug) DO NOTHING
    `;
    slug = change.slug;
  }

  let settings: FormSettings | undefined;
  let status = row.status;
  if (change.settings) {
    const current = readSettings(row.settings);
    settings = mergeSettings(current, change.settings.patch, change.settings.password);
    status = statusAfterSettings({status: row.status, publishedVersionId: row.published_version_id}, current, settings);
  }

  // n.* is what changes (NULL = unchanged); on the right of SET, f.* is the row before.
  const [updated] = await tx.$queryRaw<{revision: number; has_unpublished: boolean; published_version_id: string | null}[]>`
    UPDATE forms f SET
      title = ${change.title ?? row.title},
      slug = ${slug},
      status = ${status},
      draft = COALESCE(n.draft, f.draft),
      theme = COALESCE(n.theme, f.theme),
      settings = COALESCE(n.settings, f.settings),
      has_unpublished = f.has_unpublished
        OR (n.draft IS NOT NULL AND f.draft IS DISTINCT FROM n.draft)
        OR (n.theme IS NOT NULL AND f.theme IS DISTINCT FROM n.theme),
      revision = f.revision + 1,
      updated_by = ${userId},
      updated_at = now()
    FROM (
      SELECT ${change.draft !== undefined ? json(change.draft) : null}::jsonb AS draft,
        ${change.theme !== undefined ? json(change.theme) : null}::jsonb AS theme,
        ${settings !== undefined ? json(settings) : null}::jsonb AS settings
    ) n
    WHERE f.id = ${id}::uuid
    RETURNING f.revision, f.has_unpublished, f.published_version_id::text AS published_version_id
  `;
  return {
    revision: updated!.revision,
    overwrote,
    overwrittenBy: overwrittenBy ? {id: overwrittenBy.id, name: overwrittenBy.name} : null,
    hasUnpublished: updated!.has_unpublished && updated!.published_version_id !== null,
    slug,
    status,
    ...(settings ? {settings: clientSettings(settings, {canEdit: true})} : {}),
  };
}

// ---------------------------------------------------------------------------
// Publish, close, reopen
// ---------------------------------------------------------------------------

/**
 * Copies the draft into a new numbered version and makes it live (a closed form stays closed).
 * Refuses an invalid or empty draft, and logic or one-per-email problems (`logic_issues`).
 */
export async function publishForm(db: PrismaClient, id: string, userId: number): Promise<PublishResponse> {
  return db.$transaction(tx => publishFormIn(tx, id, userId));
}

/** `publishForm` inside a transaction the caller opened. */
export async function publishFormIn(tx: Db, id: string, userId: number): Promise<PublishResponse> {
  const [row] = await tx.$queryRaw<
    {status: FormStatus; draft: unknown; theme: unknown; settings: unknown; published_version_id: string | null}[]
  >`
    SELECT status, draft, theme, settings, published_version_id::text AS published_version_id FROM forms WHERE id = ${id}::uuid FOR UPDATE
  `;
  if (!row) throw notFound();
  const parsed = formDefinition.safeParse(row.draft);
  if (!parsed.success) {
    throw new FormsError(422, 'validation_failed', 'Fix the highlighted fields before you publish', zodFields(parsed.error, 'draft'));
  }
  const definition = parsed.data;
  if (countFields(definition).fields === 0) {
    throw new FormsError(422, 'empty_form', 'Add at least one question before you publish');
  }
  const issues = [...lintLogic(definition), ...lintOnePerEmail(definition, readSettings(row.settings))];
  if (issues.length > 0) {
    throw new FormsError(422, 'logic_issues', 'Fix the logic rules listed before you publish', undefined, {issues});
  }

  // The row lock above serialises publishes of one form, so max + 1 is safe.
  const [version] = await tx.$queryRaw<{id: string; version: number; published_at: Date}[]>`
    INSERT INTO form_versions (form_id, version, definition, theme, published_by)
    VALUES (
      ${id}::uuid,
      (SELECT COALESCE(max(version), 0) + 1 FROM form_versions WHERE form_id = ${id}::uuid),
      ${json(definition)}::jsonb, ${json(readTheme(row.theme))}::jsonb, ${userId}
    )
    RETURNING id::text AS id, version, published_at
  `;
  // The responses catalog for this version, merged from the previous one (same lock, same transaction).
  await writeCatalogAtPublish(tx, id, row.published_version_id, version!, definition.fields);
  // A closed form stays closed: publishing a fix must not reopen it by surprise. Reopen does that.
  const status: FormStatus = row.status === 'closed' ? 'closed' : 'live';
  const [after] = await tx.$queryRaw<{revision: number; response_count: number}[]>`
    UPDATE forms SET
      published_version_id = ${version!.id}::uuid,
      status = ${status},
      has_unpublished = false,
      revision = revision + 1,
      updated_by = ${userId},
      updated_at = now()
    WHERE id = ${id}::uuid
    RETURNING revision, ${exactResponsesSql(Prisma.sql`forms.id`)} AS response_count
  `;
  return {
    version: version!.version,
    publishedAt: version!.published_at.toISOString(),
    status,
    revision: after!.revision,
    responses: after!.response_count,
  };
}

type StatusRow = {
  status: FormStatus;
  revision: number;
  has_unpublished: boolean;
  published_version_id: string | null;
  response_count: number;
  settings: unknown;
};

const statusResponse = (r: StatusRow): FormStatusResponse => ({
  status: r.status,
  revision: r.revision,
  hasUnpublished: r.has_unpublished && r.published_version_id !== null,
  responses: r.response_count,
  // Close and reopen need FORM_WRITE, so the full settings are fine to send.
  settings: clientSettings(readSettings(r.settings), {canEdit: true}),
});

/**
 * The exact response count (sum of form_counts) for the header these answers update and for the
 * cap check on reopen: right after a delete the copy on forms may still be a minute old.
 */
const EXACT_COUNT = exactResponsesSql(Prisma.sql`forms.id`);

/** Closes a published form now (one conditional statement). 409 before the first publish. */
export async function closeForm(db: Db, id: string, userId: number): Promise<FormStatusResponse> {
  const [row] = await db.$queryRaw<StatusRow[]>`
    UPDATE forms SET status = 'closed', settings = settings || '{"closed": true}'::jsonb,
      revision = revision + 1, updated_by = ${userId}, updated_at = now()
    WHERE id = ${id}::uuid AND status IN ('live', 'closed')
    RETURNING status, revision, has_unpublished, published_version_id::text AS published_version_id, ${EXACT_COUNT} AS response_count, settings
  `;
  if (row) return statusResponse(row);
  const exists = await db.form.findUnique({where: {id}, select: {id: true}});
  throw exists ? new FormsError(409, 'not_published', 'Publish the form before you close it') : notFound();
}

/**
 * Reopens a published form (one conditional statement). A close date already in the past
 * would close it again at once, so it is cleared; a form at its response cap stays closed.
 */
export async function reopenForm(db: Db, id: string, userId: number): Promise<FormStatusResponse> {
  // COALESCE: with no responseCap at all the comparison is NULL, which would block the update.
  const [row] = await db.$queryRaw<StatusRow[]>`
    UPDATE forms SET status = 'live',
      settings = settings || jsonb_build_object('closed', false)
        || CASE WHEN (settings->>'closeAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
             THEN CASE WHEN (settings->>'closeAt')::timestamptz <= now() THEN '{"closeAt": null}'::jsonb ELSE '{}'::jsonb END
             ELSE '{}'::jsonb END,
      revision = revision + 1, updated_by = ${userId}, updated_at = now()
    WHERE id = ${id}::uuid AND status IN ('closed', 'live') AND published_version_id IS NOT NULL
      AND NOT COALESCE(jsonb_typeof(settings->'responseCap') = 'number' AND ${EXACT_COUNT} >= (settings->>'responseCap')::numeric, false)
    RETURNING status, revision, has_unpublished, published_version_id::text AS published_version_id, ${EXACT_COUNT} AS response_count, settings
  `;
  if (row) return statusResponse(row);
  const form = await db.form.findUnique({where: {id}, select: {status: true, publishedVersionId: true}});
  if (!form) throw notFound();
  // At its cap the form would close again on the next submit: say what to change instead.
  if (form.publishedVersionId && (form.status === 'closed' || form.status === 'live')) {
    throw new FormsError(409, 'cap_reached', 'Raise or remove the response cap first');
  }
  throw new FormsError(409, 'not_published', 'Publish the form before you reopen it');
}
