import {Hono} from 'hono';
import {validator} from 'hono/validator';

import {problem, withDb} from '../../platform/guards';
import {legalPage, listedForms, loadSitemapForms, publicSettings} from '../intelform/public-site/data';
import {emailEnabled} from '../intelform/settings';
import {
  formsPage,
  isLegalKind,
  openNow,
  publicAppInfo,
  publicHome,
  publicLegal,
  type PublicSitemap,
  SEARCH_MAX,
} from '../intelform/public-site/shape';

/**
 * `/site-api/public-site/*` — the public website's data (home, /forms/, About, Privacy, Terms) and
 * the app's public branding. Anonymous by design: everything here is what any visitor may see
 * (published, Live, listed forms; the settings the owner made public), built field by field. No
 * route reads the visitor, so the answers may be kept by browsers for a minute.
 *
 *   GET /app          PublicAppInfo   name, logo, favicon, accent, default mode (dashboard + pages)
 *   GET /home         PublicHome      what every public page needs
 *   GET /forms        PublicFormsPage the /forms/ list page (?search=&after=<slug>)
 *   GET /legal/:kind  PublicLegalPage privacy | terms (404 otherwise)
 *   GET /sitemap      PublicSitemap   the forms /sitemap.xml lists, and the site's indexing flag
 */

const PUBLIC_MINUTE = 'public, max-age=60';

const formsQuery = validator('query', (value, c) => {
  const one = (v: unknown) => (Array.isArray(v) ? v[0] : v);
  const search = one(value.search);
  const after = one(value.after);
  if (search !== undefined && (typeof search !== 'string' || search.length > SEARCH_MAX)) {
    return c.json({...problem('invalid_search', `Search with ${SEARCH_MAX} characters or fewer.`), fields: {search: [`Use ${SEARCH_MAX} characters or fewer`]}}, 422);
  }
  if (after !== undefined && (typeof after !== 'string' || !/^[a-z0-9-]{0,60}$/.test(after))) {
    return c.json(problem('invalid_cursor', 'That page link is not valid.'), 422);
  }
  return {search: (search as string | undefined) ?? '', after: (after as string | undefined) || null};
});

const legalParam = validator('param', (value, c) => {
  const kind = String(value.kind ?? '');
  if (!isLegalKind(kind)) return c.json(problem('not_found', 'No such page.'), 404);
  return {kind};
});

export const publicSiteRoutes = new Hono()
  .get('/app', withDb, async c => {
    const settings = await publicSettings(c.var.db);
    // The dashboard reads it again right after App settings are saved: no browser cache.
    c.header('Cache-Control', 'no-cache');
    return c.json(publicAppInfo(settings, emailEnabled()));
  })

  .get('/home', withDb, async c => {
    const db = c.var.db;
    const [settings, forms] = await Promise.all([publicSettings(db), listedForms(db)]);
    c.header('Cache-Control', PUBLIC_MINUTE);
    return c.json(publicHome(settings, openNow(forms)));
  })

  .get('/forms', formsQuery, withDb, async c => {
    const {search, after} = c.req.valid('query');
    const db = c.var.db;
    const [settings, forms] = await Promise.all([publicSettings(db), listedForms(db)]);
    c.header('Cache-Control', PUBLIC_MINUTE);
    return c.json(formsPage(openNow(forms), {search, after, indexing: settings.indexing}));
  })

  .get('/legal/:kind', legalParam, withDb, async c => {
    const {kind} = c.req.valid('param');
    const legal = await legalPage(c.var.db, kind);
    c.header('Cache-Control', PUBLIC_MINUTE);
    return c.json(publicLegal(kind, legal.appName, legal.text, legal.indexing));
  })

  .get('/sitemap', withDb, async c => {
    const db = c.var.db;
    const [settings, forms] = await Promise.all([publicSettings(db), loadSitemapForms(db)]);
    const body: PublicSitemap = {indexing: settings.indexing, hasPrivacy: settings.hasPrivacy, hasTerms: settings.hasTerms, forms};
    return c.json(body);
  });
