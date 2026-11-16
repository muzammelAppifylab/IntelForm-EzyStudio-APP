import type {PrismaClient} from '../../../generated/prisma/client';
import {cache} from '../../../platform/cache';
import {defaultFormSettings} from '../../../lib/intelform/form/settings';
import {loadBySlug, SLUG_RE, type LoadedForm, type LoadResult} from './load';

/**
 * The published form as the public page and GET /site-api/public/forms/:slug show it, in the
 * Site Cache (docs/agent/cache.md):
 *
 *   form:slug:<slug>   1 day   the published, render-token-free shape of a form
 *
 * Only forms whose public answer can't go stale by itself are cached: no password (the hash
 * never goes in the cache, and the unlock check needs it) and no response cap (the cap depends
 * on the live count). The render token, Turnstile site key and "closed now" (close date) are
 * worked out per request from the cached shape. The submit always reads the database.
 *
 * Cleared (`clearPublicFormCache`, the whole prefix: a slug change also moves the old slug) after
 * publish, close / reopen, an autosave of the title, slug or settings, delete, the hourly
 * close-by-date job and a submit that closes a form at its cap.
 */

const PREFIX = 'form:slug:';
const TTL = 24 * 60 * 60;

type Cached = Omit<LoadedForm, 'responseCount'>;

function cacheable(form: LoadedForm): boolean {
  return !form.settings.passwordHash && form.settings.responseCap === null && (form.status === 'live' || form.status === 'closed');
}

/** loadBySlug through the cache. */
export async function loadPublishedBySlug(db: Pick<PrismaClient, '$queryRaw'>, slug: string): Promise<LoadResult> {
  const clean = slug.toLowerCase();
  if (!SLUG_RE.test(clean)) return {kind: 'missing'};
  const key = PREFIX + clean;
  const hit = await cache.get<Cached>(key);
  // Without a cap the count is never read by isClosed: 0 stands in.
  if (hit && hit.id && hit.definition) {
    return {kind: 'form', form: {...hit, settings: {...defaultFormSettings(), ...hit.settings, passwordHash: null}, responseCount: 0}};
  }
  const result = await loadBySlug(db, clean);
  if (result.kind === 'form' && cacheable(result.form)) {
    const {responseCount: _count, ...shape} = result.form;
    // Left out: the password hash (the cache refuses the key, even empty) and the webhook (its
    // custom header values are the owner's credentials; the public page never reads it).
    const {passwordHash: _hash, webhook: _webhook, ...settings} = shape.settings;
    await cache.set(key, {...shape, settings}, TTL);
  }
  return result;
}

/** After any write that changes what a public form page shows (see above). */
export async function clearPublicFormCache(): Promise<void> {
  await cache.delPrefix(PREFIX);
}
