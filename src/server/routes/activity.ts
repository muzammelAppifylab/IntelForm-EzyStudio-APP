import {Hono} from 'hono';
import {validator} from 'hono/validator';

import type {Prisma} from '../../generated/prisma/client';
import {
  ACTIVITY_CATEGORIES,
  type ActivityPage,
  type ActivityPeople,
  type ActivityRow,
  categoryOf,
  isActivityCategory,
} from '../../lib/activity';
import {problem, requireAuth, requirePermission, withDb, withViewer} from '../../platform/guards';
import {PERMISSIONS} from '../permissions';

/**
 * `/site-api/activity/*` (site:audit:read): the activity log, filtered.
 *
 *   GET /         ?before&limit&category&person&from&to → ActivityPage (newest first, keyset by id)
 *   GET /people   the people who acted recently, for the "Person" filter
 *
 * Never returns an email address or an IP hash: names only.
 */
/** Rows per page: one of these, picked on the screen. */
const PAGE_SIZES = [25, 50, 100] as const;
const DEFAULT_PAGE = 25;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** An ISO instant from the browser (`2026-11-18T00:00:00.000Z`): the start of a local day. */
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

const one = (value: unknown) => (typeof value === 'string' ? value : '');

const listQuery = validator('query', (value, c) => {
  const before = one(value.before);
  const category = one(value.category);
  const person = one(value.person);
  const from = one(value.from);
  const to = one(value.to);
  const limit = one(value.limit);
  const fields: Record<string, string> = {};
  if (before && !/^\d{1,19}$/.test(before)) fields.before = 'Not a valid page.';
  if (category && !isActivityCategory(category)) fields.category = 'Pick one of the listed kinds.';
  if (person && !/^[1-9]\d{0,9}$/.test(person)) fields.person = 'Pick someone from the list.';
  if (limit && !PAGE_SIZES.some(size => String(size) === limit)) fields.limit = 'Show 25, 50 or 100 rows.';
  const fromDate = from ? parseInstant(from) : null;
  const toDate = to ? parseInstant(to) : null;
  if (from && !fromDate) fields.from = 'Pick a valid start date.';
  if (to && !toDate) fields.to = 'Pick a valid end date.';
  if (fromDate && toDate && fromDate >= toDate) fields.to = 'The end date must be on or after the start date.';
  if (Object.keys(fields).length) {
    return c.json({...problem('invalid_input', 'Check the filters.'), fields}, 422);
  }
  return {
    before: before ? BigInt(before) : null,
    category: category && isActivityCategory(category) ? category : null,
    person: person ? Number(person) : null,
    from: fromDate,
    to: toDate,
    limit: limit ? Number(limit) : DEFAULT_PAGE,
  };
});

function parseInstant(value: string): Date | null {
  if (value.length > 40 || !INSTANT.test(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export const activityRoutes = new Hono()
  .get('/', listQuery, withViewer, requireAuth, requirePermission(PERMISSIONS.AUDIT_READ), withDb, async c => {
    const q = c.req.valid('query');
    const db = c.var.db;
    const PAGE = q.limit;

    const and: Prisma.AuditEventWhereInput[] = [];
    if (q.before) and.push({id: {lt: q.before}});
    if (q.category) and.push({action: {in: [...ACTIVITY_CATEGORIES[q.category].actions]}});
    // A person's activity: what they did, and what was done to their account
    // (a failed sign-in, a reset someone asked for, a role someone changed).
    if (q.person) and.push({OR: [{actorUserId: q.person}, {targetType: 'user', targetId: String(q.person)}]});
    if (q.from || q.to) and.push({createdAt: {...(q.from ? {gte: q.from} : {}), ...(q.to ? {lt: q.to} : {})}});

    const rows = await db.auditEvent.findMany({
      select: {id: true, actorUserId: true, action: true, targetType: true, targetId: true, meta: true, createdAt: true},
      where: and.length ? {AND: and} : undefined,
      orderBy: {id: 'desc'},
      take: PAGE + 1,
    });
    const page = rows.slice(0, PAGE);

    // Names for the people and things on this page: at most one bounded query per kind, together.
    const idsOf = (type: string) => [...new Set(page.filter(r => r.targetType === type && r.targetId).map(r => r.targetId!))];
    const userIds = [
      ...new Set([
        ...page.map(r => r.actorUserId).filter((id): id is number => id !== null),
        ...idsOf('user')
          .map(Number)
          .filter(id => Number.isSafeInteger(id) && id > 0),
      ]),
    ];
    const formIds = idsOf('form').filter(id => UUID.test(id));
    const templateIds = idsOf('template').filter(id => UUID.test(id));
    const themeIds = idsOf('theme').filter(id => UUID.test(id));
    const roleSlugs = idsOf('role');
    const [users, forms, templates, themes, roles] = await Promise.all([
      userIds.length ? db.user.findMany({where: {id: {in: userIds}}, select: {id: true, name: true}, take: PAGE * 2}) : [],
      formIds.length ? db.form.findMany({where: {id: {in: formIds}}, select: {id: true, title: true}, take: PAGE}) : [],
      templateIds.length ? db.template.findMany({where: {id: {in: templateIds}}, select: {id: true, name: true}, take: PAGE}) : [],
      themeIds.length ? db.theme.findMany({where: {id: {in: themeIds}}, select: {id: true, name: true}, take: PAGE}) : [],
      roleSlugs.length ? db.role.findMany({where: {slug: {in: roleSlugs}}, select: {slug: true, name: true}, take: PAGE}) : [],
    ]);
    const userNames = new Map(users.map(u => [String(u.id), u.name]));
    const names: Record<string, Map<string, string>> = {
      user: userNames,
      form: new Map(forms.map(f => [f.id, f.title])),
      template: new Map(templates.map(t => [t.id, t.name])),
      theme: new Map(themes.map(t => [t.id, t.name])),
      role: new Map(roles.map(r => [r.slug, r.name])),
    };

    const events: ActivityRow[] = page.map(row => ({
      id: row.id.toString(),
      actor:
        row.actorUserId === null
          ? null
          : {id: row.actorUserId, name: userNames.get(String(row.actorUserId)) ?? `User #${row.actorUserId}`},
      action: row.action,
      category: categoryOf(row.action),
      target: row.targetType ? `${row.targetType}:${row.targetId ?? ''}` : null,
      targetName: (row.targetType && row.targetId && names[row.targetType]?.get(row.targetId)) || null,
      meta: (row.meta as Record<string, unknown> | null) ?? null,
      createdAt: row.createdAt.toISOString(),
    }));

    c.header('Cache-Control', 'private, no-store');
    return c.json<ActivityPage>({events, nextBefore: rows.length > PAGE ? events.at(-1)!.id : null});
  })

  .get('/people', withViewer, requireAuth, requirePermission(PERMISSIONS.AUDIT_READ), withDb, async c => {
    // Whoever acted in the latest 1,000 events (still with an account): bounded, one query.
    const people = await c.var.db.$queryRaw<{id: number; name: string}[]>`
      SELECT u.id, u.name
      FROM users u
      WHERE u.id IN (
        SELECT DISTINCT r.actor_user_id
        FROM (SELECT actor_user_id FROM audit_events WHERE actor_user_id IS NOT NULL ORDER BY id DESC LIMIT 1000) r
      )
      ORDER BY lower(u.name), u.id
      LIMIT 200
    `;
    c.header('Cache-Control', 'private, no-store');
    return c.json<ActivityPeople>({people: people.map(p => ({id: Number(p.id), name: p.name}))});
  });
