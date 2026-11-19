import type {PrismaClient} from '../../../generated/prisma/client';
import {cache} from '../../../platform/cache';
import {defaultFormSettings, type FormSettings} from '../../../lib/intelform/form/settings';
import {responseNeedsJobs} from '../notify';
import {loadBySlug, SLUG_RE, type LoadedForm} from './load';

/**
 * The published form as the public page, GET /site-api/public/forms/:slug and the submit route
 * read it, in the Site Cache (docs/agent/cache.md):
 *
 *   form:slug:<slug>   1 day   the published, render-token-free shape of a live or closed form
 *
 * Read with `cache.getOrSet` (one request fills a cold key; the others wait for it). What can go
 * stale by itself is never in it, and is worked out per request:
 *  - the response count (a capped form): read exactly where it matters (load.ts formState, the
 *    rate-limit statement of the page, the submit's checks and its insert statement);
 *  - the password hash: never cached (the cache refuses it, and it is the owner's secret); the
 *    shape says `hasPassword`, and the hash is read only when a token must be checked;
 *  - the webhook (its header values are the owner's credentials): only `needsJobs` is kept;
 *  - the render token and "closed now" (close date).
 * The submit's insert statement re-checks live, the close date and the cap in the database, so
 * a cached shape a moment old can never let a response through that the database would refuse.
 *
 * Cleared per slug (`clearPublicFormSlugs`, `clearPublicFormCacheFor`: the form's slug and its
 * latest old slugs, so a rename also drops the old one) after publish, close / reopen, an
 * autosave of the title, slug or settings, and a submit that closes a form at its cap. Deleting a
 * form and the hourly close-by-date job clear the whole prefix (`clearPublicFormCache`): they are
 * rare and may touch forms whose slugs they no longer know.
 */

const PREFIX = 'form:slug:';
/** A day: every change that matters clears the key, so the TTL only bounds what nothing clears. */
const TTL = 24 * 60 * 60;
/** Old slugs cleared with a form: the latest few (an older one was cleared when it was replaced). */
const OLD_SLUGS = 5;

/** A published form, as the respondent routes use it. */
export interface PublishedForm {
  /** settings.passwordHash is always null and settings.webhook the default: use the fields below. */
  form: LoadedForm;
  hasPassword: boolean;
  /** The password hash when it was read with the form (a cache miss); undefined: read it (formState). */
  passwordHash?: string | null;
  /** A response must queue notify work (notification, confirmation email, webhook). */
  needsJobs: boolean;
  /** form.responseCount is exact (a cache miss). From the cache it is 0: read it when the form has a cap. */
  countExact: boolean;
}

export type PublishedResult = {kind: 'form'; published: PublishedForm} | {kind: 'moved'; slug: string} | {kind: 'missing'};

type CachedSettings = Omit<FormSettings, 'passwordHash' | 'webhook'>;
interface Cached extends Omit<LoadedForm, 'responseCount' | 'settings'> {
  settings: CachedSettings;
  hasPassword: boolean;
  needsJobs: boolean;
}

const keyOf = (slug: string) => PREFIX + slug;

function shapeOf(form: LoadedForm): Cached {
  const {responseCount: _count, settings, ...rest} = form;
  // Left out: the password hash (the cache refuses the key, even empty) and the webhook (its
  // custom header values are the owner's credentials).
  const {passwordHash, webhook: _webhook, ...cachedSettings} = settings;
  return {...rest, settings: cachedSettings, hasPassword: !!passwordHash, needsJobs: responseNeedsJobs(settings)};
}

function fromCache(hit: Cached): PublishedForm {
  const {hasPassword, needsJobs, settings, ...rest} = hit;
  return {
    form: {...rest, settings: {...defaultFormSettings(), ...settings, passwordHash: null}, responseCount: 0},
    hasPassword,
    needsJobs,
    countExact: false,
  };
}

/** A form read from the database: the exact count and the hash come with it. */
function fromLoaded(form: LoadedForm): PublishedForm {
  const {passwordHash} = form.settings;
  return {
    form: {...form, settings: {...form.settings, passwordHash: null}},
    hasPassword: !!passwordHash,
    passwordHash,
    needsJobs: responseNeedsJobs(form.settings),
    countExact: true,
  };
}

/** loadBySlug through the cache. Live and closed forms are cached; moved and missing slugs never. */
export async function loadPublishedBySlug(db: Pick<PrismaClient, '$queryRaw'>, slug: string): Promise<PublishedResult> {
  const clean = slug.toLowerCase();
  if (!SLUG_RE.test(clean)) return {kind: 'missing'};
  // What this request read itself (a miss): returned as it is, with the exact count and hash.
  let fresh: Awaited<ReturnType<typeof loadBySlug>> | null = null;
  const hit = await cache.getOrSet<Cached | null>(keyOf(clean), TTL, async () => {
    fresh = await loadBySlug(db, clean);
    // null is not stored: the waiting requests load for themselves.
    return fresh.kind === 'form' ? shapeOf(fresh.form) : null;
  });
  const own = fresh as Awaited<ReturnType<typeof loadBySlug>> | null;
  if (own) return own.kind === 'form' ? {kind: 'form', published: fromLoaded(own.form)} : own;
  if (hit && hit.id && hit.definition) return {kind: 'form', published: fromCache(hit)};
  // A value that isn't a form shape (should not happen): read the database.
  const r = await loadBySlug(db, clean);
  return r.kind === 'form' ? {kind: 'form', published: fromLoaded(r.form)} : r;
}

/**
 * Drops the cached form for these slugs, and the slug's form id that the respondent writes'
 * render-token check keeps under the same prefix (`form:slug:id:<slug>`, routes/public-forms.ts).
 */
export async function clearPublicFormSlugs(...slugs: (string | null | undefined)[]): Promise<void> {
  const clean = [...new Set(slugs.filter((s): s is string => !!s).map(s => s.toLowerCase()))].filter(s => SLUG_RE.test(s));
  await Promise.all(clean.flatMap(s => [cache.del(keyOf(s)), cache.del(`${PREFIX}id:${s}`)]));
}

/**
 * Drops the cached form of one form: its slug and its latest old slugs (after a rename the old
 * key would still serve the form). One small read by primary key and the form_id index.
 */
export async function clearPublicFormCacheFor(db: Pick<PrismaClient, '$queryRaw'>, formId: string): Promise<void> {
  const rows = await db.$queryRaw<{slug: string}[]>`
    (SELECT slug FROM forms WHERE id = ${formId}::uuid)
    UNION ALL
    (SELECT slug FROM form_slugs_old WHERE form_id = ${formId}::uuid ORDER BY created_at DESC LIMIT ${OLD_SLUGS})
  `;
  await clearPublicFormSlugs(...rows.map(r => r.slug));
}

/** Every cached form: after a form is deleted, and after the hourly job closes forms by date. */
export async function clearPublicFormCache(): Promise<void> {
  await cache.delPrefix(PREFIX);
}
