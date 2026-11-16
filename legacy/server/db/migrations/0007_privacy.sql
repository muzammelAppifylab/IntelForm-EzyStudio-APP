-- Privacy: answers and live links must not outlive their purpose.

-- ---------------------------------------------------------------------------
-- Webhook delivery log: each row holds the full answers it sent. It used to survive the
-- response (ON DELETE SET NULL), so deleted or retention-expired answers stayed in the log and
-- could be re-sent with Resend. Now the log row goes with its response.
-- ---------------------------------------------------------------------------
ALTER TABLE webhook_deliveries
  DROP CONSTRAINT IF EXISTS webhook_deliveries_response_id_fkey,
  ADD CONSTRAINT webhook_deliveries_response_id_fkey
    FOREIGN KEY (response_id) REFERENCES responses (id) ON DELETE CASCADE;

-- Rows already orphaned by SET NULL: real deliveries whose response is gone. Test sends
-- ("Send test" in the builder) never had a response and carry sample answers only: kept.
DELETE FROM webhook_deliveries WHERE response_id IS NULL AND NOT is_test;

-- ---------------------------------------------------------------------------
-- Jobs: payloads hold invite and password-reset links (whose tokens are otherwise stored only
-- as SHA-256) and answers (notification emails, webhooks). The worker now redacts a payload
-- when its job is done or fails for good (server/lib/jobs.ts redactPayload); do the same for
-- jobs that finished before this migration.
-- ---------------------------------------------------------------------------
UPDATE jobs
SET payload = jsonb_build_object('redacted', true)
  || jsonb_strip_nulls(jsonb_build_object('formId', payload->'formId', 'responseId', payload->'responseId'))
WHERE (done_at IS NOT NULL OR failed_at IS NOT NULL)
  AND NOT (payload ? 'redacted');
