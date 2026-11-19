import type {Context} from 'hono';

import {getAccess} from '../platform/auth/session';

/**
 * The store preview's read-only demo admin (prisma/demo-login.sql, docs/agent/store-apps.md "Make
 * every write refuse the demo role"). Its role holds read permissions only, so every write behind
 * a write permission already refuses it. This is for the few personal writes behind a READ
 * permission (a table's columns, the forms list view, the builder's presence ping): for the demo
 * they do nothing, so the screens work and nothing is stored.
 */
export const DEMO_ROLE = 'demo-read-only';

export async function isDemoViewer(c: Context): Promise<boolean> {
  return (await getAccess(c.req.raw)).roles.includes(DEMO_ROLE);
}
