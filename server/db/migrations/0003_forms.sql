-- Forms management (Agent D): autosave revisions, per-user preferences, template edits.

-- Autosave conflict detection ("last save wins", docs/research/02-builder.md). Every PATCH
-- bumps revision and records who saved, so a client can tell it overwrote someone else.
ALTER TABLE forms ADD COLUMN revision integer NOT NULL DEFAULT 0;
ALTER TABLE forms ADD COLUMN updated_by uuid REFERENCES users (id) ON DELETE SET NULL;
CREATE INDEX forms_created ON forms (created_at DESC);

CREATE INDEX form_versions_form ON form_versions (form_id);
CREATE INDEX responses_form_version ON responses (form_version_id);
CREATE INDEX form_slugs_old_form ON form_slugs_old (form_id);

ALTER TABLE templates ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX templates_order ON templates (is_builtin DESC, sort_order, created_at);

-- Per-user, per-form preferences, e.g. the responses table's visible columns.
CREATE TABLE user_form_prefs (
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  form_id     uuid NOT NULL REFERENCES forms (id) ON DELETE CASCADE,
  prefs       jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, form_id)
);
CREATE INDEX user_form_prefs_form ON user_form_prefs (form_id);

-- Per-user preferences, e.g. key 'forms.view' = "grid" | "list".
CREATE TABLE user_prefs (
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  key         text NOT NULL CHECK (key ~ '^[a-z][a-zA-Z0-9_.-]{0,63}$'),
  value       jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);
