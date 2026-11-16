/**
 * IntelForm outbound webhooks: one import for routes and jobs.
 *
 *   builder routes:  ensureWebhookSecret / rotateWebhookSecret, deliverWebhook(db, formId,
 *                    sampleWebhookPayload(...), {test: true}), resendDelivery(db, formId, id);
 *                    map `WebhookError` to `c.json({...problem(e.code, e.message)}, e.status)`.
 *   forms PATCH:     assertWebhookUrl(url) before saving; `WebhookUrlError` → 422
 *                    `{error: 'validation_failed', message, fields: {url: [message]}}`.
 *   submit:          nothing here: `queueResponseJobs` (../notify) sends the job.
 */
export { readWebhookConfig, type WebhookConfig } from './config'
export {
  assertWebhookUrl,
  deliveredOnce,
  deliverWebhook,
  describeError,
  ensureWebhookSecret,
  KEEP_DELIVERIES_PER_FORM,
  resendDelivery,
  retryableStatus,
  rotateWebhookSecret,
  trimWebhookDeliveries,
  urlPolicy,
  WEBHOOK_TIMEOUT_MS,
  WebhookError,
  type DeliverOptions,
  type DeliveryResult,
} from './deliver'
export { sampleWebhookPayload, webhookPayload, type WebhookPayload } from './payload'
export { generateWebhookSecret, signWebhook } from './sign'
export { assertSafeUrl, HTTPS_REQUIRED, isPrivateAddress, WebhookUrlError, type UrlPolicy } from './ssrf'
