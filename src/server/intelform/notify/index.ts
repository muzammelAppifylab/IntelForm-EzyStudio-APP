/**
 * IntelForm response notifications: one import for routes and jobs.
 *
 *   submit route (after commit):  await queueResponseJobs(c.req.url, {formId, formTitle, responseId, settings})
 *   builder capabilities:         mailProviderConfigured() (confirmations need the owner's mail provider)
 */
export { absoluteUrl, answeredFields, answersAsText, answerText, readAnswers, readDefinition } from './answers'
export { stripLinks, withoutLinks } from './links'
export { formatFrom, isSingleAddress, MailError, mailProvider, mailProviderConfigured, normalizeMessage, type MailMessage, type MailProvider } from './mailer'
export { doneKey, hitWindow, isDone, markDone, sweepWindows } from './markers'
export {
  CONFIRM_EMAIL_LIMIT,
  jobRequestUrl,
  notifiableTeammates,
  NOTIFY_LIST,
  queueResponseJobs,
  readJobData,
  relayToOwner,
  responseNeedsJobs,
  responsePath,
  runResponseNotify,
  runWebhookDelivery,
  WEBHOOK_LIST,
  WEBHOOK_RETRY_DELAY,
  type NotifyDeps,
  type NotifyOutcome,
  type Relay,
  type SubmittedFor,
} from './notify'
export { readNotifySettings, type NotifySettings } from './settings'
