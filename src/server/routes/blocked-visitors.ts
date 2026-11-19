import {type Context, Hono} from 'hono';
import {validator} from 'hono/validator';

import {addBlockInput, type BlockedVisitor, type BlockedVisitorsPage} from '../../lib/intelform/api-spam';
import {can, problem, requireAuth, requirePermission, withDb, withViewer} from '../../platform/guards';
import {config} from '../../platform/config';
import {addBlock, BLOCKS_PAGE, type BlockRow, listBlocks, removeBlock} from '../intelform/abuse/blocks';
import {ipBlockOf, ipKeyOfBlock, maskIpBlock} from '../intelform/respondent/crypto';
import {logActivity} from '../activity';
import {PERMISSIONS} from '../permissions';

/**
 * `/site-api/blocked-visitors/*`: the network addresses spam protection refuses (respondent
 * submits only), ../intelform/abuse/blocks.ts.
 *
 *   GET    /?before=       blocks in force, latest first, 50 a page        site:form:read
 *   POST   /  {address, length}   block an address by hand              site:intelform:settings
 *   DELETE /:id            unblock (and forget its earlier blocks)         site:intelform:settings
 *
 * The address itself is shown in full only to people who may change the app settings; everyone
 * else who can see forms sees it masked (`203.0.•.•`). Ids are the keyed hash of the block, never
 * the address. Every change is in the activity log, without the address.
 */

const ID = /^[0-9a-f]{40}$/;
const BEFORE = /^(\d{13})\.([0-9a-f]{40})$/;

type Ctx = Parameters<typeof can>[0];

const body = validator('json', (value, c) => {
  const parsed = addBlockInput.safeParse(value);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) fields[String(issue.path[0] ?? 'address')] ??= issue.message;
    return c.json({...problem('invalid_input', 'Check the highlighted fields.'), fields}, 422);
  }
  return parsed.data;
});

function view(row: BlockRow, full: boolean): BlockedVisitor {
  return {
    id: row.ip_key,
    address: full ? row.ip_block : maskIpBlock(row.ip_block),
    reason: row.reason === 'manual' ? 'manual' : 'limits',
    hits: Number(row.hits),
    step: Number(row.blocks),
    form: row.form_id && row.form_title !== null ? {id: row.form_id, title: row.form_title} : null,
    expiresAt: new Date(row.expires_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

const notConfigured = (c: Context) => c.json(problem('auth_not_configured', 'Blocking needs the site to finish its setup.'), 503);

export const blockedVisitorsRoutes = new Hono()
  .get('/', withViewer, requireAuth, requirePermission(PERMISSIONS.FORM_READ), withDb, async c => {
    const raw = c.req.query('before') ?? '';
    const m = raw ? BEFORE.exec(raw) : null;
    if (raw && !m) return c.json(problem('invalid_input', 'Not a valid page.'), 422);
    const [rows, canManage] = await Promise.all([
      listBlocks(c.var.db, m ? {at: new Date(Number(m[1])), key: m[2]!} : null),
      can(c as unknown as Ctx, PERMISSIONS.APP_SETTINGS),
    ]);
    const page = rows.slice(0, BLOCKS_PAGE);
    const last = page[page.length - 1];
    c.header('Cache-Control', 'private, no-store');
    return c.json<BlockedVisitorsPage>({
      blocks: page.map(r => view(r, canManage)),
      next: rows.length > BLOCKS_PAGE && last ? `${new Date(last.updated_at).getTime()}.${last.ip_key}` : null,
      canManage,
    });
  })

  .post('/', body, withViewer, requireAuth, requirePermission(PERMISSIONS.APP_SETTINGS), withDb, async c => {
    const input = c.req.valid('json');
    const block = ipBlockOf(input.address);
    if (!block) {
      return c.json({...problem('invalid_input', 'Check the highlighted fields.'), fields: {address: 'Enter an IP address like 203.0.113.7 or 2001:db8::1'}}, 422);
    }
    const secret = config.jwtSecret;
    if (!secret) return notConfigured(c);
    await addBlock(c.var.db, {ipKey: await ipKeyOfBlock(secret, block), ipBlock: block, length: input.length, userId: c.var.viewer.id ?? null});
    await logActivity(c, 'visitor_blocked', undefined, {automatic: false, length: input.length});
    return c.json({ok: true}, 201);
  })

  .delete('/:id', withViewer, requireAuth, requirePermission(PERMISSIONS.APP_SETTINGS), withDb, async c => {
    const id = c.req.param('id');
    if (!ID.test(id) || !(await removeBlock(c.var.db, id))) return c.json(problem('not_found', 'That block has already ended.'), 404);
    await logActivity(c, 'visitor_unblocked');
    return c.json({ok: true});
  });
