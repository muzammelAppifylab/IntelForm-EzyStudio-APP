import {Hono} from 'hono';

import {problem} from '../../platform/guards';

/**
 * `/site-api/builder/*` — Builder: a form's draft definition, fields, logic, design and autosave (FORM_WRITE).
 *
 * STUB (IntelForm migration scaffold): mounted in src/server/app.ts so every agent agrees on the
 * path; the owning agent replaces the placeholder with the real, guarded routes
 * (docs/agent/site-api.md: validator → withViewer → requireAuth → requirePermission → withDb).
 */
export const builderRoutes = new Hono().get('/', c => c.json(problem('not_implemented', 'Not built yet.'), 501));
