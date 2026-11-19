/**
 * IntelForm response notifications: one import for routes and jobs.
 *
 *   submit route:                 INSERT INTO intelform_notify_queue (response_id) in the response's own statement
 *                                 (only when responseNeedsJobs(settings))
 *   schedule (every minute):      await drainNotifyQueue(db, jobRequestUrl())   (./queue.ts)
 *   schedule (hourly):            await sendOwnerDigests(db, jobRequestUrl(), {budgetMs})   (./digest.ts)
 *   builder notification settings: notifyStats(db, formId)  (confirmations held back by the cap, digests)
 *   builder capabilities:         mailProviderConfigured() (confirmations need the owner's mail provider)
 */
export { absoluteUrl, answeredFields, answersAsText, answerText, readAnswers, readDefinition } from './answers'
export { stripLinks, withoutLinks } from './links'
export { formatFrom, isSingleAddress, MailError, mailProvider, mailProviderConfigured, normalizeMessage, type MailMessage, type MailProvider } from './mailer'
export { doneKey, hitWindow, isDone, markDone, sweepWindows } from './markers'
export { notifyStats, sendOwnerDigests, type DigestOptions, type NotifyStats } from './digest'
export {
  CONFIRM_EMAIL_LIMIT,
  jobRequestUrl,
  notifiableTeammates,
  NOTIFY_EMAILS_PER_HOUR,
  NotifyDeferred,
  OWNER_RELAY_PER_HOUR,
  ownerRelay,
  readJobData,
  relayToOwner,
  responseNeedsJobs,
  responsePath,
  runResponseNotify,
  runWebhookDelivery,
  WEBHOOK_BREAKER_THRESHOLD,
  webhookBreaker,
  type NotifyDeps,
  type NotifyOutcome,
  type NotifyRun,
  type Relay,
  type WebhookBreaker,
} from './notify'
export {
  DRAIN_BATCH,
  DRAIN_BUDGET_MS,
  DRAIN_CONCURRENCY,
  DRAIN_DEFER_MINUTES,
  DRAIN_MAX_ATTEMPTS,
  DRAIN_MAX_PER_RUN,
  drainNotifyQueue,
  type DrainOptions,
  type NotifyDrainResult,
  type NotifyWork,
} from './queue'
export { markerKeys, notifyRun, type RunOptions } from './run'
export { readNotifySettings, type NotifySettings } from './settings'
