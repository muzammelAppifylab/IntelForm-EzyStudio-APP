import {Hono} from 'hono';
import {validator} from 'hono/validator';

import type {PrismaClient} from '../../generated/prisma/client';
import {audit, canDelegate, emailAccepted, EMAIL_NOT_REAL, getAccess, normalizeEmail, SYSTEM_ROLES} from '../../platform/auth';
import {keysFor, mailDue, newResetPath, NO_PASSWORD, RESET_TTL_MINUTES, sendEmail, type Ctx, type Env} from '../../platform/auth/kit';
import {hashPassword, passwordProblem} from '../../platform/auth/password';
import {problem, requireAuth, requirePermission, withAuthCore, withViewer} from '../../platform/guards';
import {PERMISSIONS} from '../permissions';

/**
 * `/site-api/team/*` (site:user:invite): adding people by hand, next to the
 * managed admin API (`src/platform/auth/admin.ts`, which lists and edits them).
 *
 *   POST /users              {name, email, roles: [one], password?, invite}   add someone
 *   POST /users/:id/invite   a new invite email, for an account not confirmed yet
 *
 * How the new person gets in:
 *   - invite: the platform's own "choose your password" link (a password reset link,
 *     single use, 30 minutes), relayed to their inbox. If it runs out, "Resend invite"
 *     here, or "Forgot password" on the sign-in page, sends a fresh one.
 *   - password: the admin sets the first one and shares it themselves. The account stays
 *     UNCONFIRMED: the first sign-in asks for a code from the inbox, so a typo in the
 *     address never hands an account to whoever guessed the password.
 * Either way the roles stay with the account when its inbox is proven.
 *
 * Anti-escalation, as in admin.ts: never `owner`, and only roles whose every permission
 * the admin holds. Never logs, audits or returns a password.
 */

const SLUG_RE = /^[a-z][a-z0-9-]{1,47}$/;

const idOf = (value: string) => {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};

const forbidden = (c: Ctx, message: string) => c.json(problem('forbidden', message), 403);

const invalid = (c: Ctx, fields: Record<string, string>) =>
  c.json({...problem('invalid_input', Object.values(fields)[0] ?? 'Check the form.'), fields}, 422);

const EMAIL_TAKEN = 'Someone already has an account with this email. Find them in the list and edit their roles.';

/** The codenames held by everyone with a role in `slugs` (bounded). */
const rolePermissions = (db: PrismaClient, slugs: string[]) =>
  db.role.findMany({
    where: {slug: {in: slugs}},
    select: {id: true, slug: true, permissions: {select: {permission: {select: {codename: true}}}, take: 500}},
    take: 50,
  });

/** Sends a fresh "choose your password" link, at most one per address per 15 minutes. */
async function sendInvite(c: Ctx, user: {id: number; email: string}): Promise<boolean> {
  // The same gate the sign-in page's "Forgot password" uses for an unconfirmed address.
  const keys = await keysFor(c, `unconfirmed:${user.email}`);
  if (!(await mailDue(c, keys))) return false;
  const path = await newResetPath(c, user.id, keys.ipHash);
  sendEmail(c, {kind: 'password_reset', to: user.email, path, expiresInMinutes: RESET_TTL_MINUTES});
  return true;
}

const addBody = validator('json', (value, c) => {
  const v = (value ?? {}) as Record<string, unknown>;
  const fields: Record<string, string> = {};
  const name = typeof v.name === 'string' ? v.name.trim() : '';
  if (!name || name.length > 80) fields.name = 'Enter their name, up to 80 characters.';
  const email = normalizeEmail(v.email);
  if (!email) fields.email = 'Enter a valid email address, like name@example.com.';
  const list = Array.isArray(v.roles) ? v.roles : null;
  // One role per person (the portal offers a single choice).
  if (!list || list.length !== 1 || !list.every(r => typeof r === 'string' && SLUG_RE.test(r))) {
    fields.roles = 'Pick one role from the list.';
  }
  const invite = v.invite === true;
  const password = typeof v.password === 'string' && v.password ? v.password : null;
  if (password) {
    const weak = passwordProblem(password, email ?? undefined);
    if (weak) fields.password = weak;
  } else if (!invite) {
    fields.password = 'Set a password, or email them an invite instead.';
  }
  if (Object.keys(fields).length) return c.json({...problem('invalid_input', Object.values(fields)[0]!), fields}, 422);
  return {name, email: email!, roles: [...new Set(list as string[])], invite, password};
});

export const teamRoutes = new Hono<Env>()
  .post(
    '/users',
    addBody,
    withViewer,
    requireAuth,
    requirePermission(PERMISSIONS.USER_INVITE),
    withAuthCore,
    async c => {
      const db = c.var.db;
      const input = c.req.valid('json');

      if (input.roles.includes(SYSTEM_ROLES.OWNER)) {
        return forbidden(c, 'The site owner comes from the dashboard, and is not given here.');
      }
      const roles = input.roles.length ? await rolePermissions(db, input.roles) : [];
      if (roles.length !== input.roles.length) return invalid(c, {roles: 'That role does not exist any more. Reload and pick again.'});
      const held = new Set((await getAccess(c.req.raw)).permissions);
      for (const role of roles) {
        if (!canDelegate(held, role.permissions.map(p => p.permission.codename))) {
          return forbidden(c, `You cannot give the “${role.slug}” role: it allows more than you can.`);
        }
      }

      const [taken, real] = await Promise.all([
        db.user.findUnique({where: {email: input.email}, select: {id: true}}),
        emailAccepted(c.req.url, input.email),
      ]);
      if (taken) return invalid(c, {email: EMAIL_TAKEN});
      if (!real) return invalid(c, {email: EMAIL_NOT_REAL});

      const passwordHash = input.password ? await hashPassword(input.password) : NO_PASSWORD;
      let user: {id: number; name: string; email: string};
      try {
        user = await db.user.create({
          data: {
            name: input.name,
            email: input.email,
            passwordHash,
            roles: {create: roles.map(role => ({roleId: role.id, grantedBy: c.var.viewer.id}))},
          },
          select: {id: true, name: true, email: true},
        });
      } catch (err) {
        // Two admins adding the same address at once: the unique index decides.
        if ((err as {code?: string}).code === 'P2002') return invalid(c, {email: EMAIL_TAKEN});
        throw err;
      }

      const invited = input.invite ? await sendInvite(c, user) : false;
      const {ipHash} = await keysFor(c, null);
      await audit(db, {
        actorUserId: c.var.viewer.id,
        action: 'user_added',
        target: ['user', user.id],
        ipHash,
        meta: {roles: input.roles, invited, passwordSet: Boolean(input.password)},
      });
      return c.json({user: {id: user.id, name: user.name}, invited, inviteMinutes: RESET_TTL_MINUTES}, 201);
    }
  )

  .post('/users/:id/invite', withViewer, requireAuth, requirePermission(PERMISSIONS.USER_INVITE), withAuthCore, async c => {
    const db = c.var.db;
    const id = idOf(c.req.param('id'));
    const target = id
      ? await db.user.findUnique({
          where: {id},
          select: {
            id: true,
            email: true,
            status: true,
            platformOwnerId: true,
            emailVerifiedAt: true,
            roles: {select: {role: {select: {permissions: {select: {permission: {select: {codename: true}}}, take: 500}}}}, take: 50},
          },
        })
      : null;
    if (!target || target.platformOwnerId) return c.json(problem('not_found', 'No such user.'), 404);
    if (target.emailVerifiedAt) {
      return c.json(problem('already_confirmed', 'They have already joined. They can use “Forgot password” on the sign-in page.'), 409);
    }
    if (target.status !== 'active') return c.json(problem('suspended', 'Reactivate them first, then send the invite.'), 409);
    const held = new Set((await getAccess(c.req.raw)).permissions);
    const theirs = target.roles.flatMap(r => r.role.permissions.map(p => p.permission.codename));
    if (!canDelegate(held, theirs)) return forbidden(c, 'You cannot invite someone with more access than you.');

    if (!(await sendInvite(c, target))) {
      c.header('Retry-After', '900');
      return c.json(problem('rate_limited', 'An email already went to them in the last 15 minutes. Ask them to check their inbox and spam folder.'), 429);
    }
    const {ipHash} = await keysFor(c, null);
    await audit(db, {actorUserId: c.var.viewer.id, action: 'user_invite_sent', target: ['user', target.id], ipHash});
    return c.json({ok: true, inviteMinutes: RESET_TTL_MINUTES});
  });
