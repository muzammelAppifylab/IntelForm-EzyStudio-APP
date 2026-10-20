-- Platform: background jobs, scheduler leases, rate limits, login backoff, privacy fixes.
-- Owned by Agent C (platform). See docs/research/04-backend-infra.md and 06-security-quality.md.

-- ---------------------------------------------------------------------------
-- Transactional outbox. Rows are written in the same transaction as the work that needs
-- them (a response, an invite), then claimed with FOR UPDATE SKIP LOCKED by any instance.
-- ---------------------------------------------------------------------------
CREATE TABLE jobs (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind          text NOT NULL,
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  run_at        timestamptz NOT NULL DEFAULT now(),
  attempts      integer NOT NULL DEFAULT 0,
  max_attempts  integer NOT NULL DEFAULT 3 CHECK (max_attempts >= 1),
  locked_until  timestamptz,
  last_error    text,
  done_at       timestamptz,
  failed_at     timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX jobs_due ON jobs (run_at) WHERE done_at IS NULL AND failed_at IS NULL;
CREATE INDEX jobs_done ON jobs (done_at) WHERE done_at IS NOT NULL;

-- One row per scheduled task. Whoever moves next_run_at forward wins that tick.
CREATE TABLE scheduler (
  name         text PRIMARY KEY,
  next_run_at  timestamptz NOT NULL DEFAULT now(),
  last_run_at  timestamptz,
  last_error   text
);

-- ---------------------------------------------------------------------------
-- Rate limits: fixed windows, one upsert per check. UNLOGGED: losing counts on a crash is fine.
-- ---------------------------------------------------------------------------
CREATE UNLOGGED TABLE rate_limits (
  key             text NOT NULL,
  window_start    timestamptz NOT NULL,
  window_seconds  integer NOT NULL,
  count           integer NOT NULL DEFAULT 1,
  PRIMARY KEY (key, window_start)
);
CREATE INDEX rate_limits_expiry ON rate_limits (window_start);

-- Per-account login backoff: after 5 failures, wait 1, 2, 4 … 15 minutes. Keyed by the
-- lowercased email, whether or not an account exists, so the 429 reveals nothing.
CREATE TABLE login_attempts (
  email            text PRIMARY KEY,
  failures         integer NOT NULL DEFAULT 0,
  locked_until     timestamptz,
  last_failure_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Privacy (A12): sessions keep a salted hash of the IP, never the raw address.
-- ---------------------------------------------------------------------------
ALTER TABLE sessions RENAME COLUMN ip TO ip_hash;
UPDATE sessions SET ip_hash = NULL;
CREATE INDEX sessions_expiry ON sessions (expires_at);
CREATE INDEX password_resets_user_open ON password_resets (user_id) WHERE used_at IS NULL;

-- ---------------------------------------------------------------------------
-- Webhooks: the per-form signing secret lives outside forms.settings (which the browser
-- reads), encrypted. The delivery log keeps what Resend needs.
-- ---------------------------------------------------------------------------
ALTER TABLE forms ADD COLUMN webhook_secret text;

ALTER TABLE webhook_deliveries
  ADD COLUMN webhook_id text,
  ADD COLUMN error      text,
  ADD COLUMN payload    jsonb;

-- Retention deletes by submitted_at across all forms.
CREATE INDEX responses_submitted ON responses (submitted_at);

-- Lenient timestamp parse for jsonb settings (a malformed date must not break a whole UPDATE).
CREATE FUNCTION intelform_try_timestamptz(value text) RETURNS timestamptz
LANGUAGE plpgsql STABLE AS $$
BEGIN
  RETURN value::timestamptz;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$;
