import {Hono} from 'hono';

import {problem} from '../../platform/guards';

/**
 * `/site-api/contacts/*` — Contacts gathered from responses (CONTACT_READ / CONTACT_WRITE).
 *
 * STUB (IntelForm migration scaffold): mounted in src/server/app.ts so every agent agrees on the
 * path; the owning agent replaces the placeholder with the real, guarded routes
 * (docs/agent/site-api.md: validator → withViewer → requireAuth → requirePermission → withDb).
 */
export const contactsRoutes = new Hono().get('/', c => c.json(problem('not_implemented', 'Not built yet.'), 501));
