import {Hono, type Context} from 'hono';
import {bodyLimit} from 'hono/body-limit';

import {isPreview} from '../platform/api';
import {adminRoutes, authRoutes, getAccess, getViewer} from '../platform/auth';
import {config} from '../platform/config';
import {csrf, previewCookies, problem, sameOrigin} from '../platform/guards';
import {syncPermissions} from '../platform/permission-sync';
import {authSettings} from './auth-settings';
import {checkoutRoutes, membershipRoutes} from './routes/checkout';
import {abilitiesFor, CATALOGUE} from './permissions';
import {appSettingsRoutes} from './routes/app-settings';
import {builderRoutes} from './routes/builder';
import {contactsRoutes} from './routes/contacts';
import {formsRoutes} from './routes/forms';
import {publicFormsRoutes} from './routes/public-forms';
import {publicSiteRoutes} from './routes/public-site';
import {responsesRoutes} from './routes/responses';
import {siteRoutes} from './routes/site';
import {templatesRoutes} from './routes/templates';
import {themesRoutes} from './routes/themes';
import {uploadsRoutes} from './routes/uploads';
import {formDraftRoutes} from './intelform/builder/form-routes';

const tooLarge = (c: Context) => c.json(problem('too_large', 'That request is too large.'), 413);
const defaultBodyLimit = bodyLimit({maxSize: 64 * 1024, onError: tooLarge});
const draftBodyLimit = bodyLimit({maxSize: 512 * 1024, onError: tooLarge});
const DRAFT_PATH = /^\/site-api\/(?:builder\/)?forms\/[0-9a-f-]{36}$/i;
const isDraftAutosave = (method: string, path: string) => method === 'PATCH' && DRAFT_PATH.test(path);

/**
 * The Site API: this site's ONLY backend, one Hono app at `/site-api/*`.
 *
 * Everything reads and writes through it: the Astro pages call it IN-PROCESS
 * (`src/server/backend.ts`), the portal and the `/account` pages call it from
 * the browser (`siteFetch` / the typed `hc` client, `src/portal/api.ts`).
 * Mounted by ONE catch-all page, `src/pages/site-api/[...path].ts`.
 *
 *   GET  /health        what this site has been given (booleans only)
 *   GET  /me            the visitor + what the UI may show them
 *   *    /auth/...      sign-up, sign-in, sessions, passwords   platform/auth/routes.ts
 *   *    /admin/...     users, roles, audit log (admins)        platform/auth/admin.ts
 *   GET  /site          the site's brand                        routes/site.ts
 *   *    /forms/...     IntelForm: forms (list, create, publish) routes/forms.ts
 *   *    /builder/...   a form's definition, logic, autosave     routes/builder.ts
 *   *    /templates/... form templates                           routes/templates.ts
 *   *    /themes/...    form design themes                       routes/themes.ts
 *   *    /responses/... responses, summaries, export             routes/responses.ts
 *   *    /public/forms/... the respondent side (anonymous)       routes/public-forms.ts
 *   *    /contacts/...  contacts from responses                  routes/contacts.ts
 *   *    /uploads/...   form images and answer files             routes/uploads.ts
 *   *    /app-settings  IntelForm's app-wide settings            routes/app-settings.ts
 *   *    /public-site/... data for the public website            routes/public-site.ts
 *   *    /checkout/...  start and confirm a payment             routes/checkout.ts
 *   *    /memberships/... the member's memberships               routes/checkout.ts
 *
 * Add a feature as a new `routes/<name>.ts` and one `.route()` line below,
 * CHAINED so `AppType` carries every route to the typed client. Errors are
 * JSON `{error, message}`. `sameOrigin` + `csrf` refuse every cross-site or
 * token-less write; keep them, with `previewCookies` before them (a webhook
 * that must accept a cross-site write gets its own app, mounted before them,
 * with its own authentication).
 */
export const app = new Hono()
  .basePath('/site-api')
  // The editor Preview only: auth cookies carried in headers (its gateway drops cookies).
  .use(previewCookies)
  .use(sameOrigin)
  // The Buy button posts here as a plain form too (no JavaScript): BEFORE `csrf`, with its own
  // `formCsrf` (the token, or a same-origin form post). Keep it here (docs/agent/payments.md).
  .route('/checkout', checkoutRoutes)
  .use(csrf)
  // No route here takes a big body; uploads never pass through the Worker. The one exception is
  // the form builder's autosave (PATCH /forms/:id), which carries the whole draft: 512 KB there.
  .use((c, next) => (isDraftAutosave(c.req.method, c.req.path) ? draftBodyLimit : defaultBodyLimit)(c, next))
  // New catalogue codenames reach the `permissions` table (once per isolate; no migration).
  .use(syncPermissions(CATALOGUE))

  .get('/health', c =>
    c.json({
      ok: true,
      preview: isPreview(),
      database: Boolean(config.databaseUrl),
      auth: Boolean(config.jwtSecret && config.databaseUrl),
      siteKey: Boolean(config.siteKey),
    })
  )

  // `abilities` only decides what the UI SHOWS; every guarded route checks again.
  .get('/me', async c => {
    const [viewer, access] = await Promise.all([getViewer(c.req.raw), getAccess(c.req.raw)]);
    c.header('Cache-Control', 'private, no-store');
    // One flag per catalogue entry with an `ability` (src/server/permissions.ts).
    const abilities = abilitiesFor(new Set(access.permissions));
    return c.json({viewer, roles: access.roles, abilities});
  })

  .route('/auth', authRoutes(authSettings))
  .route('/admin', adminRoutes)
  .route('/site', siteRoutes)
  // Autosave, publish and versions first (PATCH /:id, POST /:id/publish), then the rest.
  .route('/forms', formDraftRoutes)
  .route('/forms', formsRoutes)
  .route('/builder', builderRoutes)
  .route('/templates', templatesRoutes)
  .route('/themes', themesRoutes)
  .route('/responses', responsesRoutes)
  // Respondents are anonymous but SAME-ORIGIN (the form at /f/<slug> and its embed are pages
  // of this site), so they stay behind sameOrigin + csrf like every write (siteFetch sends the token).
  .route('/public/forms', publicFormsRoutes)
  .route('/contacts', contactsRoutes)
  .route('/uploads', uploadsRoutes)
  .route('/app-settings', appSettingsRoutes)
  .route('/public-site', publicSiteRoutes)
  .route('/memberships', membershipRoutes)

  .notFound(c => c.json(problem('not_found', 'No such Site API route.'), 404))
  .onError((err, c) => {
    // The message only: an error object can carry request details.
    console.error(`site-api ${c.req.method} ${c.req.path}: ${err.message}`);
    return c.json(problem('internal_error', 'Something went wrong.'), 500);
  });

export type AppType = typeof app;
