import {keepPreviousData, queryOptions} from '@tanstack/react-query';

import type {ActivityPage, ActivityPeople} from '../lib/activity';
import type {AdminUser, AuditRow, PermissionRow, RoleRow} from '../lib/types';
import {refreshSession} from '../platform/browser';
import {api, read} from './api';
import type {Me} from './shared';

/**
 * Every portal read, ONCE: the screen (`useQuery(x)`) and its route's loader
 * (`queryClient.ensureQueryData(x)`, src/portal/routes.tsx) use the same
 * options, so a hover on a link fetches what the screen will show and the
 * screen renders from the cache. Kept apart from the screens so the routes can
 * import them without pulling the (lazy) screen code into the first bundle.
 *
 * A save invalidates by key prefix (`['users']`, `['roles']`).
 *
 * IntelForm's reads live per domain in `./intelform/queries/<domain>.ts` (forms, builder,
 * responses, contacts, templates, themes, app-settings…), each owned by its screen; keep
 * this file to the template's own reads.
 */

/** Who is signed in, and what the portal may SHOW them. Shared by every screen. */
export const meQuery = queryOptions({
  queryKey: ['me'],
  queryFn: async () => {
    const me = await read<Me>(api.me.$get());
    // The access token ran out but the refresh token is still there: refresh ONCE.
    if (me.viewer.state === 'returning' && (await refreshSession())) return read<Me>(api.me.$get());
    return me;
  },
  staleTime: 60_000,
});

/** The brand, for the sidebar. Public and cached on the server. */
export const siteQuery = queryOptions({
  queryKey: ['site'],
  queryFn: () => read<{site: {name: string; logo: string | null} | null}>(api.site.$get()),
  staleTime: 5 * 60_000,
});

export const healthQuery = queryOptions({
  queryKey: ['health'],
  queryFn: () => read<{database: boolean; auth: boolean; siteKey: boolean}>(api.health.$get()),
});

export type UsersPage = {users: AdminUser[]; nextBefore: number | null};
export type AuditPage = {events: AuditRow[]; nextBefore: string | null};

/** The overview's tiles: the FIRST page of each list, under the lists' own key prefixes. */
export const firstUsersQuery = queryOptions({
  queryKey: ['users', 'first'],
  queryFn: () => read<UsersPage>(api.admin.users.$get({query: {before: '', email: '', status: ''}})),
});
export const firstAuditQuery = queryOptions({
  queryKey: ['audit', 'first'],
  queryFn: () => read<AuditPage>(api.admin.audit.$get({query: {before: ''}})),
});

/**
 * `/dashboard/users`: one page of accounts (25, newest first), filtered by exact email and
 * status, starting after `before` (the previous page's `nextBefore`; '' for page 1). The
 * screen keeps the `before` of every page it walked, so Previous is one request away.
 */
export const usersQuery = (filter: {email: string; status: string}, before = '') =>
  queryOptions({
    queryKey: ['users', filter, before],
    queryFn: () => read<UsersPage>(api.admin.users.$get({query: {before, email: filter.email, status: filter.status}})),
    placeholderData: keepPreviousData,
    gcTime: 60_000,
  });

/** The Activity screen's filters, as they sit in its URL (`?kind=forms&from=2026-11-01`). */
export type ActivityFilter = {kind: string; person: string; from: string; to: string; size: string};

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The route's `validateSearch`: anything odd in the URL is dropped, never sent on. */
export function readActivitySearch(search: Record<string, unknown>): Partial<ActivityFilter> {
  const text = (value: unknown, test: RegExp) =>
    typeof value === 'string' && test.test(value) ? value : typeof value === 'number' && test.test(String(value)) ? String(value) : undefined;
  const out: Partial<ActivityFilter> = {
    kind: text(search.kind, /^[a-z]{1,20}$/),
    person: text(search.person, /^[1-9]\d{0,9}$/),
    from: text(search.from, DAY),
    to: text(search.to, DAY),
    size: text(search.size, /^(50|100)$/),
  };
  if (out.from && out.to && out.from > out.to) out.to = undefined;
  return Object.fromEntries(Object.entries(out).filter(([, value]) => value !== undefined));
}

export const activityFilterOf = (search: Partial<ActivityFilter>): ActivityFilter => ({
  kind: search.kind ?? '',
  person: search.person ?? '',
  from: search.from ?? '',
  to: search.to ?? '',
  size: search.size ?? '',
});

/** A `YYYY-MM-DD` day as the instant it starts in the viewer's time zone (`plusDays` later). */
function localDayStart(day: string, plusDays = 0): string {
  if (!DAY.test(day)) return '';
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const date = new Date(y, m - 1, d + plusDays);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

/** Rows per page on the Activity screen; the server accepts exactly these. */
export const ACTIVITY_PAGE_SIZES = [25, 50, 100] as const;
export type ActivityPageSize = (typeof ACTIVITY_PAGE_SIZES)[number];
export const activityPageSize = (size: string): ActivityPageSize =>
  ACTIVITY_PAGE_SIZES.find(n => String(n) === size) ?? ACTIVITY_PAGE_SIZES[0];

/**
 * `/dashboard/activity`: ONE page of the activity log, newest first, filtered by kind,
 * person and dates. Keyset paged: `before` is the last id of the page before (empty for
 * page 1), so page N never re-reads or skips rows when new events arrive.
 */
export const activityQuery = (filter: ActivityFilter, before = '') =>
  queryOptions({
    queryKey: ['audit', 'activity', filter, before],
    queryFn: () =>
      read<ActivityPage>(
        api.activity.$get({
          query: {
            before,
            limit: String(activityPageSize(filter.size)),
            category: filter.kind,
            person: filter.person,
            // Whole days in the viewer's own time zone: from the start of `from` to the end of `to`.
            from: localDayStart(filter.from),
            to: localDayStart(filter.to, 1),
          },
        })
      ),
  });

/** Who acted recently: the Activity screen's "Person" filter. */
export const activityPeopleQuery = queryOptions({
  queryKey: ['audit', 'people'],
  queryFn: () => read<ActivityPeople>(api.activity.people.$get()),
  staleTime: 5 * 60_000,
});

export const rolesQuery = queryOptions({
  queryKey: ['roles'],
  queryFn: () => read<{roles: RoleRow[]}>(api.admin.roles.$get()),
});

/** The permission catalogue: changes only with a migration. */
export const permissionsQuery = queryOptions({
  queryKey: ['permissions'],
  queryFn: () => read<{permissions: PermissionRow[]}>(api.admin.permissions.$get()),
  staleTime: 5 * 60_000,
});

/** Two-step sign-in, for the account screen. */
export type TwoFactorStatus = {enabled: boolean; recoveryCodesLeft: number; hasPassword: boolean};
export const twoFactorQuery = queryOptions({
  queryKey: ['account', 'two-factor'],
  queryFn: () => read<TwoFactorStatus>(api.auth['two-factor'].$get()),
});

/** The devices signed in to this account (this one marked `current`). */
export type DeviceSession = {id: string; device: string; lastActiveAt: string; current: boolean};
export const sessionsQuery = queryOptions({
  queryKey: ['account', 'sessions'],
  queryFn: () => read<{sessions: DeviceSession[]}>(api.auth.sessions.$get()),
});
