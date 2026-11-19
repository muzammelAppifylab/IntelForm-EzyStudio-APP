import type {PrismaClient} from '../generated/prisma/client';
// The writer alone, not the auth index: routes that log stay free of the auth routes.
import {audit, type AuditInput} from '../platform/auth/audit';
import type {Viewer} from '../platform/types';

/**
 * Records one thing a signed-in person did in the app (forms, responses,
 * settings) in the same `audit_events` log as sign-ins and role changes, so
 * the Activity screen shows it. Never throws (`audit` swallows a failed
 * write): the action it records has already succeeded.
 *
 * Every action written here is listed in `src/lib/activity.ts`. `meta` holds
 * small, non-personal facts only (a form's title, a count): never an email
 * address, an answer, a URL, a secret or a request body.
 */
export function logActivity(
  c: {var: {db: PrismaClient; viewer: Viewer}},
  action: string,
  target?: AuditInput['target'],
  meta?: AuditInput['meta']
): Promise<void> {
  return audit(c.var.db, {actorUserId: c.var.viewer.id ?? null, action, target, meta});
}

/** A title for `meta`: trimmed and short, so one row never grows big. */
export const titleMeta = (title: string) => title.trim().slice(0, 120);
