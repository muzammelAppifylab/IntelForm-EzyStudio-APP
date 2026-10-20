-- IntelForm initial schema. Mirrors the PRD "Data model (PostgreSQL)" section.
-- All ids are UUIDs except public slugs. Field ids and option ids live inside the jsonb
-- definitions as short random strings and never change once created.
-- Tokens (sessions, invites, password resets) are stored as SHA-256 hashes, never raw.

-- ---------------------------------------------------------------------------
-- Accounts and team
-- ---------------------------------------------------------------------------

CREATE TABLE users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL,
  email          text NOT NULL UNIQUE CHECK (email = lower(email)),
  password_hash  text NOT NULL,
  avatar_url     text,
  role           text NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  status         text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- Exactly one active Owner per install. "At least one" is enforced in the transfer route.
CREATE UNIQUE INDEX users_one_owner ON users ((true)) WHERE role = 'owner' AND status = 'active';

CREATE TABLE sessions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash  text NOT NULL UNIQUE,
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  expires_at  timestamptz NOT NULL,
  user_agent  text,
  ip          text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user ON sessions (user_id);

CREATE TABLE invites (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email        text NOT NULL CHECK (email = lower(email)),
  role         text NOT NULL CHECK (role IN ('editor', 'viewer')),
  token_hash   text NOT NULL UNIQUE,
  invited_by   uuid REFERENCES users (id) ON DELETE SET NULL,
  expires_at   timestamptz NOT NULL,
  accepted_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
-- One open invite per email; re-inviting replaces it.
CREATE UNIQUE INDEX invites_open_email ON invites (email) WHERE accepted_at IS NULL;

CREATE TABLE password_resets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Forms
-- ---------------------------------------------------------------------------

CREATE TABLE forms (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                  text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]*$'),
  title                 text NOT NULL,
  status                text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'live', 'closed')),
  draft                 jsonb NOT NULL,
  published_version_id  uuid,
  settings              jsonb NOT NULL DEFAULT '{}'::jsonb,
  theme                 jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- True when the draft has changed since the last Publish (header shows "Unpublished changes").
  has_unpublished       boolean NOT NULL DEFAULT false,
  created_by            uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX forms_updated ON forms (updated_at DESC);

CREATE TABLE form_versions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id       uuid NOT NULL REFERENCES forms (id) ON DELETE CASCADE,
  version       integer NOT NULL,
  definition    jsonb NOT NULL,
  theme         jsonb NOT NULL,
  published_at  timestamptz NOT NULL DEFAULT now(),
  published_by  uuid REFERENCES users (id) ON DELETE SET NULL,
  UNIQUE (form_id, version)
);

ALTER TABLE forms
  ADD CONSTRAINT forms_published_version_fk
  FOREIGN KEY (published_version_id) REFERENCES form_versions (id) ON DELETE SET NULL;

-- Old slugs keep redirecting to their form after a slug change.
CREATE TABLE form_slugs_old (
  slug     text PRIMARY KEY,
  form_id  uuid NOT NULL REFERENCES forms (id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------------------
-- Responses and analytics
-- ---------------------------------------------------------------------------

CREATE TABLE responses (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id          uuid NOT NULL REFERENCES forms (id) ON DELETE CASCADE,
  form_version_id  uuid NOT NULL REFERENCES form_versions (id) ON DELETE CASCADE,
  answers          jsonb NOT NULL,
  started_at       timestamptz,
  submitted_at     timestamptz NOT NULL DEFAULT now(),
  duration_ms      integer,
  ip_hash          text,
  country          text,
  device           text,
  browser          text,
  browser_token    text
);
CREATE INDEX responses_form_submitted ON responses (form_id, submitted_at DESC);
CREATE INDEX responses_answers ON responses USING gin (answers jsonb_path_ops);

CREATE TABLE form_events (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  form_id        uuid NOT NULL REFERENCES forms (id) ON DELETE CASCADE,
  type           text NOT NULL CHECK (type IN ('view', 'start')),
  session_token  text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  -- One view and one start per browser session.
  UNIQUE (form_id, type, session_token)
);
CREATE INDEX form_events_funnel ON form_events (form_id, type, created_at);

CREATE TABLE webhook_deliveries (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id        uuid NOT NULL REFERENCES forms (id) ON DELETE CASCADE,
  response_id    uuid REFERENCES responses (id) ON DELETE SET NULL,
  url            text NOT NULL,
  status_code    integer,
  duration_ms    integer,
  response_body  text,
  is_test        boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX webhook_deliveries_form ON webhook_deliveries (form_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Themes, templates, app settings
-- ---------------------------------------------------------------------------

CREATE TABLE themes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  settings    jsonb NOT NULL,
  created_by  uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE templates (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug         text NOT NULL UNIQUE,
  name         text NOT NULL,
  category     text NOT NULL,
  description  text NOT NULL DEFAULT '',
  definition   jsonb NOT NULL,
  theme        jsonb NOT NULL DEFAULT '{}'::jsonb,
  settings     jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_builtin   boolean NOT NULL DEFAULT false,
  created_by   uuid REFERENCES users (id) ON DELETE SET NULL,
  sort_order   integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Key/value settings. Secret values are encrypted by the server before they are stored.
-- Keys: general, branding, turnstile, email, data, front_page, legal.
CREATE TABLE app_settings (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
