import {audit} from '../../../platform/auth/audit';
import type {PrismaClient} from '../../../platform/db';
import {config} from '../../../platform/config';
import {hitWindow} from '../notify/markers';
import {MailError, normalizeMessage, type MailProvider} from '../notify/mailer';
import {ownerRelay} from '../notify/notify';
import {notifyRun, type NotifyRun, type Relay} from '../notify/run';
import {readNotifySettings} from '../notify/settings';

/**
 * What spam protection tells people, in two ways, both bounded so a flood never becomes a flood
 * of emails or log rows:
 *
 *   - the activity log (`audit_events`, the Activity screen's "Spam protection" group): every
 *     automatic block; a form or site limit reached and a confirmation email skipped, once per
 *     form per hour per reason;
 *   - an email to the form's notification recipients (the site owner when none are chosen, or
 *     through the platform relay), at most once per form per hour for the submit side and once per
 *     form per hour for the confirmation emails.
 *
 * Called after the visitor got their answer (the submit route's waitUntil, or inside the notify
 * job). Never throws: protection already happened, this only reports it.
 */

export type AbuseEvent =
  /** The form's per-minute limit, or the site's, refused submits. */
  | {kind: 'limit'; formId: string; scope: 'form' | 'site'}
  /** An address block was blocked automatically (a fresh block, not one already in force). */
  | {kind: 'blocked'; formId: string; step: number; strikes: number; until: Date}
  /** A confirmation email was not sent (the response is saved). */
  | {kind: 'confirm-skipped'; formId: string; reason: ConfirmSkipReason};

export type ConfirmSkipReason = 'ip' | 'form' | 'recipient' | 'site';

/** Activity-log actions (listed in src/lib/activity.ts). */
export const ABUSE_ACTIONS = {
  limit: 'spam_limit_reached',
  blocked: 'visitor_blocked',
  'confirm-skipped': 'confirmation_skipped',
} as const;

export interface AbuseDeps {
  /** The drain's run (relay, mail provider, teammates); default: a new one at the site's address. */
  run?: NotifyRun;
  relay?: Relay;
  mail?: MailProvider | null;
}

const HOUR = 3600;

const REASON_TEXT: Record<ConfirmSkipReason, string> = {
  ip: 'one network asked for more than 3 confirmation emails in an hour',
  form: 'the form reached its hourly limit for confirmation emails',
  recipient: 'the same address was already sent a confirmation today',
  site: 'the site reached its daily limit for confirmation emails',
};

function message(e: AbuseEvent, title: string): {subject: string; text: string} {
  switch (e.kind) {
    case 'limit':
      return {
        subject: `Spam protection is turning responses away: ${title}`,
        text:
          `${title} is getting more responses than ${e.scope === 'site' ? 'your site allows a minute, across every form' : 'it allows a minute'}, ` +
          `so some were turned away. If these are real people, raise the limit in ${e.scope === 'site' ? 'Settings, Spam protection' : "the form's Spam protection settings"}.`,
      };
    case 'blocked':
      return {
        subject: `A visitor was blocked: ${title}`,
        text:
          `One network kept sending more responses to ${title} than its spam protection allows, so it is blocked ` +
          `until ${e.until.toISOString().slice(0, 16).replace('T', ' ')} UTC. Schools and offices share one network: ` +
          'if these are real people, unblock it in Settings, Spam protection, and raise the form’s limits.',
      };
    case 'confirm-skipped':
      return {
        subject: `Some confirmation emails weren’t sent: ${title}`,
        text: `Some confirmation emails for ${title} weren’t sent: ${REASON_TEXT[e.reason]}. The responses are saved.`,
      };
  }
}

/** Logs and alerts one event (see above). */
export async function recordAbuse(db: PrismaClient, e: AbuseEvent, deps: AbuseDeps = {}): Promise<void> {
  try {
    const reason = e.kind === 'limit' ? e.scope : e.kind === 'confirm-skipped' ? e.reason : 'auto';
    // The log: every block; the rest once per form per hour per reason.
    const logIt = e.kind === 'blocked' || (await hitWindow(db, `abuse-log:${e.kind}:${reason}:${e.formId}`, HOUR)) === 1;
    if (logIt) {
      const meta: Record<string, string | number | boolean> =
        e.kind === 'blocked' ? {automatic: true, step: e.step, strikes: e.strikes} : e.kind === 'limit' ? {limit: e.scope} : {reason: e.reason};
      await audit(db, {actorUserId: null, action: ABUSE_ACTIONS[e.kind], target: ['form', e.formId], meta});
    }
    const group = e.kind === 'confirm-skipped' ? 'mail' : 'submit';
    if ((await hitWindow(db, `abuse-alert:${group}:${e.formId}`, HOUR)) !== 1) return;
    await alertRecipients(db, e, deps);
  } catch (err) {
    console.warn(`[intelform] spam protection alert failed (${(err as Error).message.slice(0, 80)})`);
  }
}

async function alertRecipients(db: PrismaClient, e: AbuseEvent, deps: AbuseDeps): Promise<void> {
  const form = await db.form.findUnique({where: {id: e.formId}, select: {id: true, title: true, settings: true}});
  if (!form) return;
  const run =
    deps.run ??
    notifyRun(db, {relay: deps.relay ?? ownerRelay(), mail: deps.mail, origin: config.siteUrl ?? null});
  const settings = readNotifySettings(form.settings);
  const [team, mail] = await Promise.all([run.team(settings.notifyRecipients), run.mail()]);
  const path = `/dashboard/forms/${encodeURIComponent(form.id)}/settings`;
  const {subject, text} = message(e, form.title);
  const link = run.origin ? `${run.origin.replace(/\/+$/, '')}${path}` : path;
  // Teammates need a mail provider; without one (or with none chosen) the owner hears instead.
  if (team.ownerChosen || !mail || !team.recipients.length) {
    try {
      await run.relay(path);
    } catch {
      // The relay didn't answer: this hour's alert is lost, the next one goes.
    }
  }
  if (!mail || !team.recipients.length) return;
  await Promise.all(
    team.recipients.map(async u => {
      const m = normalizeMessage({to: u.email, subject, text: `${text}\n\nOpen the form's settings:\n${link}\n`});
      if (!m) return;
      const key = `job:abuse-alert:${e.formId}:${Math.floor(Date.now() / 3_600_000)}:u${u.id}`;
      try {
        await mail.send(m, {idempotencyKey: key});
      } catch (err) {
        if (!(err instanceof MailError)) throw err;
      }
    })
  );
}
