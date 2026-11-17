/**
 * IntelForm outbound webhooks: the one implementation of the config, the signature, the sample
 * payload and the signed POST, for both delivery paths.
 *
 *   real responses:   the notify job (../notify) calls `deliverWebhook`; a failure worth
 *                     retrying goes to `intelform-webhook-deliver`, which the platform retries.
 *   builder:          "Send test" / "Resend" queue a row and run it once in `intelform-webhooks`
 *                     (../builder/webhook-delivery.ts, built on `postSigned` and the secret here).
 *   form settings:    the URL rule (`assertSafeUrl` with `urlPolicy()`) on save and before every send.
 */
export { readWebhookConfig, type WebhookConfig } from './config'
export {
  deliveredOnce,
  deliverWebhook,
  describeError,
  ensureWebhookSecret,
  KEEP_DELIVERIES_PER_FORM,
  postSigned,
  readCapped,
  retryableStatus,
  rotateWebhookSecret,
  trimWebhookDeliveries,
  urlPolicy,
  WEBHOOK_OFF,
  WEBHOOK_TIMEOUT_MS,
  WebhookError,
  type DeliverOptions,
  type DeliveryResult,
  type PostOutcome,
} from './deliver'
export { sampleWebhookPayload, webhookPayload, type WebhookPayload } from './payload'
export { generateWebhookSecret, newWebhookId, signWebhook } from './sign'
export { assertSafeUrl, HTTPS_REQUIRED, isPrivateAddress, WebhookUrlError, type UrlPolicy } from './ssrf'
