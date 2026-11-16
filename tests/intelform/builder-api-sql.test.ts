import {readFileSync} from 'node:fs';

import {describe, expect, it} from 'vitest';

import {createDb} from '../../src/platform/db';
import {publishInTx} from '../../src/server/intelform/builder/publish';
import {leavePresence, pollPresence} from '../../src/server/intelform/builder/presence';
import {rateLimit} from '../../src/server/intelform/builder/rate-limit';
import {preparePatch, saveInTx} from '../../src/server/intelform/builder/save';
import {ensureWebhookSecret, insertDelivery, rotateWebhookSecret, runDelivery} from '../../src/server/intelform/builder/webhook-delivery';

/**
 * The builder's SQL against a real Postgres, inside ONE transaction that is always rolled back
 * (nothing is left behind). Opt-in: BUILDER_SQL_CHECK=1 with DATABASE_URL in .env.
 */
const url = (() => {
  if (!process.env.BUILDER_SQL_CHECK) return '';
  try {
    return /^DATABASE_URL=(.*)$/m.exec(readFileSync('.env', 'utf8'))?.[1]?.trim() ?? '';
  } catch {
    return '';
  }
})();

class Rollback extends Error {}

describe.skipIf(!url)('builder SQL (rolled back)', () => {
  it('saves, publishes, tracks presence and logs webhooks', async () => {
    const db = createDb(url);
    const out: string[] = [];
    try {
      await db.$transaction(
        async tx => {
          const [u] = await tx.$queryRaw<{id: number}[]>`
            INSERT INTO users (email, password_hash, name, updated_at) VALUES ('builder-sql@example.com', 'x', 'Builder', now()) RETURNING id`;
          const [u2] = await tx.$queryRaw<{id: number}[]>`
            INSERT INTO users (email, password_hash, name, updated_at) VALUES ('builder-sql2@example.com', 'x', 'Other', now()) RETURNING id`;
          const userId = u!.id;
          const [f] = await tx.$queryRaw<{id: string; slug: string}[]>`
            INSERT INTO forms (slug, title, draft) VALUES ('builder-sql-test', 'SQL test', '{"layout":"all_at_once","fields":[]}'::jsonb)
            RETURNING id::text AS id, slug`;
          const [g] = await tx.$queryRaw<{id: string}[]>`
            INSERT INTO forms (slug, title, draft) VALUES ('builder-sql-other', 'Other', '{}'::jsonb) RETURNING id::text AS id`;
          const formId = f!.id;

          // Empty form: publish refused.
          await expect(publishInTx(tx, formId, userId)).rejects.toMatchObject({code: 'empty_form'});

          const patch = await preparePatch(
            {
              title: 'Renamed',
              slug: 'spring-survey-sql',
              draft: {layout: 'all_at_once', fields: [{id: 'f_name0001', type: 'short_text', label: 'Name', props: {}}]},
              settings: {closedMessage: 'Shut', password: 'open sesame'},
            },
            {allowHttp: false}
          );
          const saved = await saveInTx(tx, {formId, patch, expected: 0, userId});
          expect(saved).toMatchObject({revision: 1, overwrote: false, slug: 'spring-survey-sql', hasUnpublished: false});
          expect(saved.settings?.hasPassword).toBe(true);
          const old = await tx.$queryRaw<{slug: string}[]>`SELECT slug FROM form_slugs_old WHERE form_id = ${formId}::uuid`;
          expect(old.map(o => o.slug)).toEqual(['builder-sql-test']);

          // Another form can't take the old or the new slug.
          await expect(
            saveInTx(tx, {formId: g!.id, patch: await preparePatch({slug: 'builder-sql-test'}), expected: null, userId})
          ).rejects.toMatchObject({status: 422, fields: {slug: [expect.any(String)]}});

          // Stale revision from another person: last save wins and says whose save it replaced.
          const stale = await saveInTx(tx, {formId, patch: await preparePatch({title: 'Theirs'}), expected: 0, userId: u2!.id});
          expect(stale).toMatchObject({revision: 2, overwrote: true, overwrittenBy: {id: userId, name: 'Builder'}});

          const v1 = await publishInTx(tx, formId, userId);
          expect(v1).toMatchObject({version: 1, status: 'live', revision: 3});
          // Nothing changed: a repeat answers the same version.
          expect(await publishInTx(tx, formId, userId)).toMatchObject({version: 1, revision: 3});

          const edited = await saveInTx(tx, {
            formId,
            patch: await preparePatch({
              draft: {layout: 'all_at_once', fields: [{id: 'f_name0001', type: 'short_text', label: 'Your name', props: {}}]},
            }),
            expected: 3,
            userId,
          });
          expect(edited.hasUnpublished).toBe(true);
          // The same draft again: still unpublished, no false "changed" either way.
          const v2 = await publishInTx(tx, formId, userId);
          expect(v2.version).toBe(2);
          const versions = await tx.$queryRaw<{version: number; label: string}[]>`
            SELECT version, definition->'fields'->0->>'label' AS label FROM form_versions WHERE form_id = ${formId}::uuid ORDER BY version`;
          expect(versions).toEqual([
            {version: 1, label: 'Name'},
            {version: 2, label: 'Your name'},
          ]);

          // Close via settings moves the status.
          const closed = await saveInTx(tx, {formId, patch: await preparePatch({settings: {closed: true}}), expected: null, userId});
          expect(closed.status).toBe('closed');

          // Presence: an editor is seen by another tab; a viewer (touch false) is not recorded.
          const me = await pollPresence(tx, {formId, tabId: 'tab-aaaaaaaa', userId, touch: true});
          expect(me?.others).toEqual([]);
          expect(me?.updatedBy).toEqual({id: userId, name: 'Builder'});
          const other = await pollPresence(tx, {formId, tabId: 'tab-bbbbbbbb', userId: u2!.id, touch: false});
          expect(other?.others).toEqual([{userId, name: 'Builder', self: false}]);
          const again = await pollPresence(tx, {formId, tabId: 'tab-aaaaaaaa', userId, touch: true});
          expect(again?.others).toEqual([]);
          await leavePresence(tx, {formId, tabId: 'tab-aaaaaaaa', userId});
          expect((await pollPresence(tx, {formId, tabId: 'tab-bbbbbbbb', userId: u2!.id, touch: false}))?.others).toEqual([]);
          expect(await pollPresence(tx, {formId: '00000000-0000-4000-8000-0000000000ff', tabId: 'tab-x', userId, touch: true})).toBeNull();

          // Webhook secret, a queued delivery and its job run.
          const s1 = await ensureWebhookSecret(tx, formId);
          expect(await ensureWebhookSecret(tx, formId)).toBe(s1);
          const s2 = await rotateWebhookSecret(tx, formId);
          expect(s2).not.toBe(s1);
          await tx.$executeRaw`UPDATE forms SET settings = settings || '{"webhook":{"enabled":true,"url":"https://hooks.example.com/x","headers":[]}}'::jsonb WHERE id = ${formId}::uuid`;
          const q = await insertDelivery(tx, {formId, responseId: null, payload: {type: 'response.test'}, isTest: true, url: 'https://hooks.example.com/x'});
          const result = await runDelivery(tx, q.deliveryId, {fetch: (async () => new Response('ok', {status: 202})) as never, allowHttp: false});
          expect(result).toMatchObject({ok: true, statusCode: 202});
          expect(await runDelivery(tx, q.deliveryId, {fetch: (async () => new Response('again')) as never})).toBeNull();
          const [d] = await tx.$queryRaw<{status_code: number; response_body: string}[]>`
            SELECT status_code, response_body FROM webhook_deliveries WHERE id = ${q.deliveryId}::uuid`;
          expect(d).toEqual({status_code: 202, response_body: 'ok'});

          // Rate limit: the 3rd hit in the window is refused.
          await rateLimit(tx, `builder-sql:${userId}`, 2, 600);
          await rateLimit(tx, `builder-sql:${userId}`, 2, 600);
          await expect(rateLimit(tx, `builder-sql:${userId}`, 2, 600)).rejects.toMatchObject({status: 429});

          out.push('ok');
          throw new Rollback();
        },
        {timeout: 30_000}
      );
    } catch (err) {
      if (!(err instanceof Rollback)) throw err;
    } finally {
      await db.$disconnect();
    }
    expect(out).toEqual(['ok']);
  });
});
