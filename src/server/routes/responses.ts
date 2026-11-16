import {Hono} from 'hono';

import {problem} from '../../platform/guards';

/**
 * `/site-api/responses/*` — Responses: list, read, summary, export, delete (RESPONSE_READ / RESPONSE_DELETE).
 *
 * STUB (IntelForm migration scaffold): mounted in src/server/app.ts so every agent agrees on the
 * path; the owning agent replaces the placeholder with the real, guarded routes
 * (docs/agent/site-api.md: validator → withViewer → requireAuth → requirePermission → withDb).
 */
export const responsesRoutes = new Hono().get('/', c => c.json(problem('not_implemented', 'Not built yet.'), 501));
