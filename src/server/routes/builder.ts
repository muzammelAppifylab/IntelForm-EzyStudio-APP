import {Hono, type Context} from 'hono';

import {
  presenceInput,
  type BuilderCapabilities,
  type PresenceResponse,
  type WebhookDeliveriesResponse,
  type WebhookDelivery,
  type WebhookSecretResponse,
  type WebhookSendResult,
} from '../../lib/intelform/api-builder';
import {formDefinition} from '../../lib/intelform/form/definition';
import {webhookSettingsInput, type WebhookSettings} from '../../lib/intelform/form/settings';
import {config} from '../../platform/config';
import {storageUsage} from '../../platform/files';
import type {PrismaClient} from '../../platform/db';
import {can, problem, requireAuth, requirePermission, withDb, withViewer} from '../../platform/guards';
import {readSettings} from '../intelform/builder/draft';
import {clearPublicFormCacheFor} from '../intelform/respondent/cache';
import {BuilderError, builderError, formGone, GONE, uuidOrNull} from '../intelform/builder/errors';
import {formDraftRoutes} from '../intelform/builder/form-routes';
import {leavePresence, pollPresence} from '../intelform/builder/presence';
import {notifyStats} from '../intelform/notify';
import {mailProviderConfigured} from '../intelform/notify/mailer';
import {rateLimit} from '../intelform/builder/rate-limit';
import {preparePatch, saveFormPatch} from '../intelform/builder/save';
import {deliveryState} from '../intelform/builder/webhook-core';
import {enqueueDelivery, insertDelivery} from '../intelform/builder/webhook-delivery';
import {readWebhookConfig, rotateWebhookSecret, sampleWebhookPayload, WEBHOOK_OFF} from '../intelform/webhooks';
import {zodJson} from '../intelform/builder/validate';
import type {Viewer} from '../../platform/types';
import {grants} from '../../platform/auth/codenames';
import {logActivity} from '../activity';
import {PERMISSIONS} from '../permissions';
import {isDemoViewer} from '../demo-role';

/** `can()` takes a plain viewer context; a route with a json validator has a wider one. */
type ViewerContext = Context<{Variables: {viewer: Viewer}}>;

/**
 * `/site-api/builder/*`: the builder's tools that are not plain form CRUD.
 *
 *   GET    /capabilities                                   what this site supports      FORM_READ
 *   POST   /forms/:id/presence {tabId}                     who else is here             FORM_READ
 *   DELETE /forms/:id/presence/:tabId                      this tab closed              FORM_READ
 *   GET    /forms/:id/webhook                              config + hasSecret           FORM_WRITE
 *   PUT    /forms/:id/webhook {enabled?, url?, headers?}   change the webhook           FORM_WRITE
 *   DELETE /forms/:id/webhook                              turn off, forget url+secret  FORM_WRITE
 *   POST   /forms/:id/webhook/secret                       new signing secret (once)    FORM_WRITE
 *   POST   /forms/:id/webhook/test                         queue a sample delivery      FORM_WRITE
 *   GET    /forms/:id/webhook/deliveries                   the last 100 deliveries      FORM_WRITE
 *   GET    /forms/:id/webhook/deliveries/:deliveryId       one delivery (poll a queued one)
 *   POST   /forms/:id/webhook/deliveries/:deliveryId/resend  same payload and webhook-id
 *   *      /forms/...                                      autosave, publish, versions (formDraftRoutes)
 *
 * Deliveries run in the background job list `intelform-webhooks` (webhook-delivery.ts): test
 * and resend answer at once with the delivery's id and `queued: true` while it is still on its
 * way (on a developer's machine and in the Preview it has already run, and the answer has the
 * outcome). Test and Resend are one attempt each; real responses retry on their own (../notify).
 * Webhook URL and headers are secrets, so every webhook route needs FORM_WRITE.
 */

const notFound = problem('not_found', GONE);

/** Storage the owner hasn't set up (files.md "Limits and errors"): the builder warns about it. */
const STORAGE_NOT_SET_UP = new Set(['E_STORAGE_NEEDS_PACK', 'E_STORAGE_OFF', 'E_STORAGE_UNAVAILABLE']);

async function storageState(requestUrl: string): Promise<BuilderCapabilities['storage']> {
  if (!config.siteKey) return 'not_set_up';
  try {
    const usage = await storageUsage(requestUrl);
    if (usage.ok) return 'ready';
    return STORAGE_NOT_SET_UP.has(usage.code) ? 'not_set_up' : 'unknown';
  } catch {
    return 'unknown';
  }
}
const DELIVERY_GONE = 'That delivery is no longer in the log';
const TEST_LIMIT = {count: 20, windowSeconds: 600};

type SendAnswer = WebhookSendResult & {queued: boolean};

interface DeliveryRow {
  id: string;
  createdAt: Date;
  url: string;
  statusCode: number | null;
  durationMs: number | null;
  responseBody: string | null;
  error: string | null;
  isTest: boolean;
  responseId: string | null;
}

const deliverySelect = {
  id: true,
  createdAt: true,
  url: true,
  statusCode: true,
  durationMs: true,
  responseBody: true,
  error: true,
  isTest: true,
  responseId: true,
} as const;

function deliveryView(r: DeliveryRow): WebhookDelivery & {pending: boolean} {
  // A queued row whose job never finished (15 minutes) shows as failed, so the builder stops polling.
  const {ok, pending, error} = deliveryState(r);
  return {
    id: r.id,
    createdAt: r.createdAt.toISOString(),
    url: r.url,
    statusCode: r.statusCode,
    durationMs: r.durationMs,
    responseBody: r.responseBody,
    error,
    isTest: r.isTest,
    responseId: r.responseId,
    ok,
    pending,
  };
}

/** The answer to test / resend: the outcome when it already ran (locally), else "queued". */
async function sendAnswer(db: PrismaClient, deliveryId: string): Promise<SendAnswer> {
  const row = await db.webhookDelivery.findUnique({where: {id: deliveryId}, select: deliverySelect});
  if (!row) throw new BuilderError(404, 'not_found', DELIVERY_GONE);
  const {ok, pending, error} = deliveryState(row);
  return {ok, statusCode: row.statusCode, durationMs: row.durationMs ?? 0, error, deliveryId, queued: pending};
}

async function webhookView(db: PrismaClient, formId: string) {
  const form = await db.form.findUnique({where: {id: formId}, select: {settings: true, webhookSecret: true}});
  if (!form) return null;
  const {webhook} = readSettings(form.settings);
  return {hasSecret: form.webhookSecret !== null, webhook};
}

/** Saves the form's webhook through the autosave path (validation, SSRF check, revision bump). */
async function saveWebhook(db: PrismaClient, formId: string, userId: number, webhook: Partial<WebhookSettings>) {
  const patch = await preparePatch({settings: {webhook}});
  const saved = await saveFormPatch(db, {formId, patch, expected: null, userId});
  // The cached public form decides whether a submit queues notify work (`needsJobs`): without
  // this, a webhook turned on here would miss every response until that cache entry expired.
  if (saved.status !== 'draft') await clearPublicFormCacheFor(db, formId);
  return saved;
}

export const builderRoutes = new Hono()
  // ---------------------------------------------------------------- capabilities
  .get('/capabilities', withViewer, requireAuth, requirePermission(PERMISSIONS.FORM_READ), async c => {
    return c.json<BuilderCapabilities>({
      // Notification and confirmation emails go through the platform's relay (the Site Key).
      emailEnabled: Boolean(config.siteKey) || config.localDev,
      mailProvider: mailProviderConfigured(),
      storage: await storageState(c.req.url),
    });
  })

  // -------------------------------------------- presence (viewers count too: they see who edits)
  .post(
    '/forms/:id/presence',
    zodJson(presenceInput),
    withViewer,
    requireAuth,
    requirePermission(PERMISSIONS.FORM_READ),
    withDb,
    async c => {
      const formId = uuidOrNull(c.req.param('id'));
      if (!formId) return c.json(notFound, 404);
      // Viewers can't edit, so they never raise the "someone else is editing" banner for others;
      // the read-only demo is never written down either (it sees who edits, nobody sees it).
      const touch = (await can(c as unknown as ViewerContext, PERMISSIONS.FORM_WRITE)) && !(await isDemoViewer(c));
      const answer = await pollPresence(c.var.db, {formId, tabId: c.req.valid('json').tabId, userId: c.var.viewer.id!, touch});
      if (!answer) return c.json(notFound, 404);
      return c.json<PresenceResponse>(answer);
    }
  )
  .delete('/forms/:id/presence/:tabId', withViewer, requireAuth, requirePermission(PERMISSIONS.FORM_READ), withDb, async c => {
    const formId = uuidOrNull(c.req.param('id'));
    const tabId = c.req.param('tabId');
    if (!formId || !presenceInput.shape.tabId.safeParse(tabId).success) return c.json(notFound, 404);
    await leavePresence(c.var.db, {formId, tabId, userId: c.var.viewer.id!});
    return c.body(null, 204);
  })

  // ------------------------------------------------------------------- webhook
  // Notification counts for the last 24 h (confirmations held back by the hourly cap, responses
  // covered by the hourly digest). Numbers only, no addresses.
  .get('/forms/:id/notify-stats', withViewer, requireAuth, requirePermission(PERMISSIONS.FORM_READ), withDb, async c => {
    const formId = uuidOrNull(c.req.param('id'));
    const stats = formId ? await notifyStats(c.var.db, formId) : null;
    if (!stats) return c.json(notFound, 404);
    return c.json(stats);
  })
  .get('/forms/:id/webhook', withViewer, requireAuth, requirePermission(PERMISSIONS.FORM_WRITE), requirePermission(PERMISSIONS.RESPONSE_READ), withDb, async c => {
    const formId = uuidOrNull(c.req.param('id'));
    const view = formId ? await webhookView(c.var.db, formId) : null;
    if (!view) return c.json(notFound, 404);
    return c.json(view);
  })
  .put(
    '/forms/:id/webhook',
    zodJson(webhookSettingsInput.partial().strict(), 'Check the webhook settings.'),
    withViewer,
    requireAuth,
    requirePermission(PERMISSIONS.FORM_WRITE), requirePermission(PERMISSIONS.RESPONSE_READ),
    withDb,
    async c => {
      const formId = uuidOrNull(c.req.param('id'));
      if (!formId) return c.json(notFound, 404);
      try {
        const saved = await saveWebhook(c.var.db, formId, c.var.viewer.id!, c.req.valid('json'));
        await logActivity(c, 'webhook_saved', ['form', formId]);
        const view = await webhookView(c.var.db, formId);
        if (!view) throw formGone();
        return c.json({...view, revision: saved.revision});
      } catch (err) {
        return builderError(c, err);
      }
    }
  )
  .delete('/forms/:id/webhook', withViewer, requireAuth, requirePermission(PERMISSIONS.FORM_WRITE), requirePermission(PERMISSIONS.RESPONSE_READ), withDb, async c => {
    const formId = uuidOrNull(c.req.param('id'));
    if (!formId) return c.json(notFound, 404);
    try {
      const saved = await saveWebhook(c.var.db, formId, c.var.viewer.id!, {enabled: false, url: null, headers: []});
      // Without a URL the secret signs nothing: a new webhook gets a new one.
      await c.var.db.form.updateMany({where: {id: formId}, data: {webhookSecret: null}});
      await logActivity(c, 'webhook_removed', ['form', formId]);
      return c.json({hasSecret: false, webhook: {enabled: false, url: null, headers: []}, revision: saved.revision});
    } catch (err) {
      return builderError(c, err);
    }
  })

  /** Generates or regenerates the signing secret. The only time it is shown. */
  .post('/forms/:id/webhook/secret', withViewer, requireAuth, requirePermission(PERMISSIONS.FORM_WRITE), requirePermission(PERMISSIONS.RESPONSE_READ), withDb, async c => {
    const formId = uuidOrNull(c.req.param('id'));
    if (!formId) return c.json(notFound, 404);
    try {
      const secret = await rotateWebhookSecret(c.var.db, formId);
      if (!secret) throw formGone();
      await logActivity(c, 'webhook_secret_rotated', ['form', formId]);
      return c.json<WebhookSecretResponse>({secret});
    } catch (err) {
      return builderError(c, err);
    }
  })

  .post('/forms/:id/webhook/test', withViewer, requireAuth, requirePermission(PERMISSIONS.FORM_WRITE), requirePermission(PERMISSIONS.RESPONSE_READ), withDb, async c => {
    const formId = uuidOrNull(c.req.param('id'));
    if (!formId) return c.json(notFound, 404);
    const db = c.var.db;
    try {
      await rateLimit(db, `webhook-test:${c.var.viewer.id}`, TEST_LIMIT.count, TEST_LIMIT.windowSeconds);
      const form = await db.form.findUnique({
        where: {id: formId},
        select: {id: true, title: true, draft: true, settings: true, publishedVersion: {select: {version: true}}},
      });
      if (!form) throw formGone();
      const cfg = readWebhookConfig(form.settings);
      if (!cfg.url) throw new BuilderError(422, 'webhook_not_configured', 'Add a webhook URL first');
      const parsed = formDefinition.safeParse(form.draft);
      const payload = sampleWebhookPayload(
        {id: form.id, title: form.title, version: form.publishedVersion?.version ?? null},
        parsed.success ? parsed.data : null
      );
      const {deliveryId} = await insertDelivery(db, {formId, responseId: null, payload, isTest: true, url: cfg.url});
      await enqueueDelivery(db, c.req.url, deliveryId, `Webhook test · ${form.title}`);
      return c.json<SendAnswer>(await sendAnswer(db, deliveryId));
    } catch (err) {
      return builderError(c, err);
    }
  })

  .get('/forms/:id/webhook/deliveries', withViewer, requireAuth, requirePermission(PERMISSIONS.FORM_WRITE), requirePermission(PERMISSIONS.RESPONSE_READ), withDb, async c => {
    const formId = uuidOrNull(c.req.param('id'));
    if (!formId) return c.json(notFound, 404);
    const form = await c.var.db.form.findUnique({
      where: {id: formId},
      select: {webhookDeliveries: {orderBy: [{createdAt: 'desc'}, {id: 'desc'}], take: 100, select: deliverySelect}},
    });
    if (!form) return c.json(notFound, 404);
    return c.json<WebhookDeliveriesResponse>({deliveries: form.webhookDeliveries.map(deliveryView)});
  })

  .get(
    '/forms/:id/webhook/deliveries/:deliveryId',
    withViewer,
    requireAuth,
    requirePermission(PERMISSIONS.FORM_WRITE), requirePermission(PERMISSIONS.RESPONSE_READ),
    withDb,
    async c => {
      const formId = uuidOrNull(c.req.param('id'));
      const deliveryId = uuidOrNull(c.req.param('deliveryId'));
      const row =
        formId && deliveryId
          ? await c.var.db.webhookDelivery.findFirst({where: {id: deliveryId, formId}, select: deliverySelect})
          : null;
      if (!row) return c.json(problem('not_found', DELIVERY_GONE), 404);
      return c.json({delivery: deliveryView(row)});
    }
  )

  .post(
    '/forms/:id/webhook/deliveries/:deliveryId/resend',
    withViewer,
    requireAuth,
    requirePermission(PERMISSIONS.FORM_WRITE), requirePermission(PERMISSIONS.RESPONSE_READ),
    withDb,
    async c => {
      const formId = uuidOrNull(c.req.param('id'));
      const deliveryId = uuidOrNull(c.req.param('deliveryId'));
      if (!formId || !deliveryId) return c.json(problem('not_found', DELIVERY_GONE), 404);
      const db = c.var.db;
      try {
        await rateLimit(db, `webhook-test:${c.var.viewer.id}`, TEST_LIMIT.count, TEST_LIMIT.windowSeconds);
        // Scoped to the form in the same query: a delivery id from another form is "not found".
        const d = await db.webhookDelivery.findFirst({
          where: {id: deliveryId, formId},
          select: {
            payload: true,
            isTest: true,
            responseId: true,
            webhookId: true,
            form: {select: {title: true, settings: true}},
          },
        });
        if (!d || d.payload === null) throw new BuilderError(404, 'not_found', DELIVERY_GONE);
        // A real delivery whose response was deleted: its answers must not go out again.
        if (!d.isTest && !d.responseId) {
          throw new BuilderError(410, 'response_deleted', 'That response was deleted, so its webhook can’t be resent');
        }
        // Only ever to the form's CURRENT URL, never the one in the log: once the webhook is
        // removed (or, for a real response, turned off) nothing is resent.
        const cfg = readWebhookConfig(d.form.settings);
        if (!d.isTest && (!cfg.url || !cfg.enabled)) throw new BuilderError(422, 'webhook_disabled', WEBHOOK_OFF);
        if (!cfg.url) throw new BuilderError(422, 'webhook_not_configured', 'Add a webhook URL first');
        const queued = await insertDelivery(db, {
          formId,
          responseId: d.responseId,
          payload: d.payload,
          isTest: d.isTest,
          webhookId: d.webhookId,
          url: cfg.url,
        });
        await enqueueDelivery(db, c.req.url, queued.deliveryId, `Webhook resend · ${d.form.title}`);
        return c.json<SendAnswer>(await sendAnswer(db, queued.deliveryId));
      } catch (err) {
        return builderError(c, err);
      }
    }
  )

  // ------------------------------------------------------------------- teammates
  // "Who gets it" in a form's notification settings: active people who may read responses, plus
  // the site owner. Names only: another user's email address never leaves the server (security.md).
  .get('/teammates', withViewer, requireAuth, requirePermission(PERMISSIONS.FORM_WRITE), withDb, async c => {
    const users = await c.var.db.user.findMany({
      where: {status: 'active'},
      orderBy: [{name: 'asc'}, {id: 'asc'}],
      take: 200,
      select: {
        id: true,
        name: true,
        platformOwnerId: true,
        roles: {select: {role: {select: {permissions: {select: {permission: {select: {codename: true}}}, take: 500}}}}, take: 50},
      },
    });
    const members: {id: number; name: string; owner: boolean}[] = [];
    for (const u of users) {
      const owner = u.platformOwnerId != null;
      const codes = new Set<string>();
      for (const r of u.roles) for (const p of r.role.permissions) codes.add(p.permission.codename);
      if (!owner && !grants(codes, PERMISSIONS.RESPONSE_READ)) continue;
      members.push({id: u.id, name: u.name || 'Unnamed', owner});
      if (members.length >= 50) break;
    }
    c.header('Cache-Control', 'private, no-store');
    return c.json({members});
  })

  // Autosave, publish and versions also answer here (their main home is /site-api/forms).
  .route('/forms', formDraftRoutes);
