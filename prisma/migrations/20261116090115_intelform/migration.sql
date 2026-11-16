-- IntelForm: forms, published versions, responses (contacts are derived from them), the funnel,
-- webhook deliveries, saved themes and templates, per-user preferences, builder presence, the
-- public routes' rate limits and the app settings. Ported from legacy/server/db/migrations;
-- IntelForm's own users, sessions, invites, password resets, jobs, scheduler and secret
-- settings are gone: the template's auth, users and roles, background jobs and owner secrets
-- replace them (docs/agent/database.md, roles-and-permissions.md).
-- Wrapped in one transaction: if any statement fails, none of them apply.
BEGIN;

-- CreateTable
CREATE TABLE "forms" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slug" VARCHAR(60) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "status" VARCHAR(10) NOT NULL DEFAULT 'draft',
    "draft" JSONB NOT NULL,
    "published_version_id" UUID,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "theme" JSONB NOT NULL DEFAULT '{}',
    "has_unpublished" BOOLEAN NOT NULL DEFAULT false,
    "webhook_secret" VARCHAR(255),
    "revision" INTEGER NOT NULL DEFAULT 0,
    "response_count" INTEGER NOT NULL DEFAULT 0,
    "last_response_at" TIMESTAMPTZ(3),
    "created_by" INTEGER,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "forms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "form_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "form_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "definition" JSONB NOT NULL,
    "theme" JSONB NOT NULL,
    "published_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_by" INTEGER,

    CONSTRAINT "form_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "form_slugs_old" (
    "slug" VARCHAR(60) NOT NULL,
    "form_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "form_slugs_old_pkey" PRIMARY KEY ("slug")
);

-- CreateTable
CREATE TABLE "responses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "form_id" UUID NOT NULL,
    "form_version_id" UUID NOT NULL,
    "answers" JSONB NOT NULL,
    "started_at" TIMESTAMPTZ(3),
    "submitted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "duration_ms" INTEGER,
    "ip_hash" VARCHAR(64),
    "country" VARCHAR(2),
    "device" VARCHAR(16),
    "browser" VARCHAR(40),
    "browser_token" VARCHAR(64),
    "search_text" TEXT NOT NULL DEFAULT '',
    "ttc" JSONB,
    "email_key" VARCHAR(254),
    "contact_email" VARCHAR(254),
    "contact_name" VARCHAR(200),
    "contact_phone" VARCHAR(20),
    "contact_key" VARCHAR(260),

    CONSTRAINT "responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "form_events" (
    "id" BIGSERIAL NOT NULL,
    "form_id" UUID NOT NULL,
    "type" VARCHAR(8) NOT NULL,
    "session_token" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "form_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "form_event_counts" (
    "form_id" UUID NOT NULL,
    "bucket" TIMESTAMPTZ(3) NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,
    "starts" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "form_event_counts_pkey" PRIMARY KEY ("form_id","bucket")
);

-- CreateTable
CREATE TABLE "webhook_deliveries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "form_id" UUID NOT NULL,
    "response_id" UUID,
    "webhook_id" VARCHAR(64),
    "url" VARCHAR(2000) NOT NULL,
    "status_code" INTEGER,
    "duration_ms" INTEGER,
    "response_body" VARCHAR(1024),
    "error" VARCHAR(500),
    "payload" JSONB,
    "is_test" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "themes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(80) NOT NULL,
    "settings" JSONB NOT NULL,
    "created_by" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "themes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "templates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slug" VARCHAR(80) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "category" VARCHAR(40) NOT NULL,
    "description" VARCHAR(300) NOT NULL DEFAULT '',
    "definition" JSONB NOT NULL,
    "theme" JSONB NOT NULL DEFAULT '{}',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_by" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_form_prefs" (
    "user_id" INTEGER NOT NULL,
    "form_id" UUID NOT NULL,
    "prefs" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_form_prefs_pkey" PRIMARY KEY ("user_id","form_id")
);

-- CreateTable
CREATE TABLE "user_prefs" (
    "user_id" INTEGER NOT NULL,
    "key" VARCHAR(64) NOT NULL,
    "value" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_prefs_pkey" PRIMARY KEY ("user_id","key")
);

-- CreateTable
CREATE TABLE "response_table_prefs" (
    "user_id" INTEGER NOT NULL,
    "form_id" UUID NOT NULL,
    "columns" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "response_table_prefs_pkey" PRIMARY KEY ("user_id","form_id")
);

-- CreateTable
CREATE TABLE "form_presence" (
    "form_id" UUID NOT NULL,
    "tab_id" VARCHAR(64) NOT NULL,
    "user_id" INTEGER NOT NULL,
    "seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "form_presence_pkey" PRIMARY KEY ("form_id","tab_id")
);

-- CreateTable
CREATE TABLE "intelform_rate_limits" (
    "key" VARCHAR(200) NOT NULL,
    "window_start" TIMESTAMPTZ(3) NOT NULL,
    "window_seconds" INTEGER NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "intelform_rate_limits_pkey" PRIMARY KEY ("key","window_start")
);

-- CreateTable
CREATE TABLE "intelform_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "app_name" VARCHAR(60) NOT NULL DEFAULT 'IntelForm',
    "logo_url" VARCHAR(2048),
    "favicon_url" VARCHAR(2048),
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'UTC',
    "date_format" VARCHAR(12) NOT NULL DEFAULT 'DD/MM/YYYY',
    "accent_color" VARCHAR(7),
    "default_mode" VARCHAR(6) NOT NULL DEFAULT 'system',
    "default_theme_id" VARCHAR(100),
    "turnstile_site_key" VARCHAR(200),
    "retention_days" INTEGER,
    "site_indexing" BOOLEAN NOT NULL DEFAULT false,
    "site_description" VARCHAR(300) NOT NULL DEFAULT '',
    "site_og_image" VARCHAR(2048),
    "contact_email" VARCHAR(254) NOT NULL DEFAULT '',
    "privacy_text" VARCHAR(50000) NOT NULL DEFAULT '',
    "terms_text" VARCHAR(50000) NOT NULL DEFAULT '',
    "email_from_name" VARCHAR(100),
    "email_reply_to" VARCHAR(254),
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "intelform_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "forms_slug_key" ON "forms"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "forms_published_version_id_key" ON "forms"("published_version_id");

-- CreateIndex
CREATE INDEX "forms_updated_at_id_idx" ON "forms"("updated_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "forms_created_at_id_idx" ON "forms"("created_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "forms_response_count_updated_at_idx" ON "forms"("response_count" DESC, "updated_at" DESC);

-- CreateIndex
CREATE INDEX "forms_status_updated_at_idx" ON "forms"("status", "updated_at" DESC);

-- CreateIndex
CREATE INDEX "forms_created_by_idx" ON "forms"("created_by");

-- CreateIndex
CREATE INDEX "forms_updated_by_idx" ON "forms"("updated_by");

-- CreateIndex
CREATE INDEX "form_versions_published_by_idx" ON "form_versions"("published_by");

-- CreateIndex
CREATE UNIQUE INDEX "form_versions_form_id_version_key" ON "form_versions"("form_id", "version");

-- CreateIndex
CREATE INDEX "form_slugs_old_form_id_idx" ON "form_slugs_old"("form_id");

-- CreateIndex
CREATE INDEX "responses_form_id_submitted_at_id_idx" ON "responses"("form_id", "submitted_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "responses_form_version_id_idx" ON "responses"("form_version_id");

-- CreateIndex
CREATE INDEX "responses_submitted_at_idx" ON "responses"("submitted_at");

-- CreateIndex
CREATE INDEX "form_events_created_at_idx" ON "form_events"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "form_events_form_id_type_session_token_key" ON "form_events"("form_id", "type", "session_token");

-- CreateIndex
CREATE INDEX "webhook_deliveries_form_id_created_at_id_idx" ON "webhook_deliveries"("form_id", "created_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "webhook_deliveries_response_id_idx" ON "webhook_deliveries"("response_id");

-- CreateIndex
CREATE INDEX "webhook_deliveries_created_at_idx" ON "webhook_deliveries"("created_at");

-- CreateIndex
CREATE INDEX "themes_created_at_id_idx" ON "themes"("created_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "themes_created_by_idx" ON "themes"("created_by");

-- CreateIndex
CREATE UNIQUE INDEX "templates_slug_key" ON "templates"("slug");

-- CreateIndex
CREATE INDEX "templates_sort_order_created_at_idx" ON "templates"("sort_order", "created_at");

-- CreateIndex
CREATE INDEX "templates_created_by_idx" ON "templates"("created_by");

-- CreateIndex
CREATE INDEX "user_form_prefs_form_id_idx" ON "user_form_prefs"("form_id");

-- CreateIndex
CREATE INDEX "response_table_prefs_form_id_idx" ON "response_table_prefs"("form_id");


-- CreateIndex
CREATE INDEX "form_presence_user_id_idx" ON "form_presence"("user_id");

-- CreateIndex
CREATE INDEX "form_presence_seen_at_idx" ON "form_presence"("seen_at");

-- CreateIndex
CREATE INDEX "intelform_rate_limits_window_start_idx" ON "intelform_rate_limits"("window_start");

-- CreateIndex
CREATE INDEX "intelform_settings_updated_by_idx" ON "intelform_settings"("updated_by");

-- AddForeignKey
ALTER TABLE "forms" ADD CONSTRAINT "forms_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forms" ADD CONSTRAINT "forms_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forms" ADD CONSTRAINT "forms_published_version_id_fkey" FOREIGN KEY ("published_version_id") REFERENCES "form_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_versions" ADD CONSTRAINT "form_versions_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_versions" ADD CONSTRAINT "form_versions_published_by_fkey" FOREIGN KEY ("published_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_slugs_old" ADD CONSTRAINT "form_slugs_old_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "responses" ADD CONSTRAINT "responses_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "responses" ADD CONSTRAINT "responses_form_version_id_fkey" FOREIGN KEY ("form_version_id") REFERENCES "form_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_events" ADD CONSTRAINT "form_events_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_event_counts" ADD CONSTRAINT "form_event_counts_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_response_id_fkey" FOREIGN KEY ("response_id") REFERENCES "responses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "themes" ADD CONSTRAINT "themes_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "templates" ADD CONSTRAINT "templates_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_form_prefs" ADD CONSTRAINT "user_form_prefs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_form_prefs" ADD CONSTRAINT "user_form_prefs_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_prefs" ADD CONSTRAINT "user_prefs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "response_table_prefs" ADD CONSTRAINT "response_table_prefs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "response_table_prefs" ADD CONSTRAINT "response_table_prefs_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_presence" ADD CONSTRAINT "form_presence_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_presence" ADD CONSTRAINT "form_presence_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intelform_settings" ADD CONSTRAINT "intelform_settings_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- CHECK constraints (the validators in src/lib/intelform check first).
-- ---------------------------------------------------------------------------
ALTER TABLE "forms" ADD CONSTRAINT "forms_slug_check" CHECK ("slug" ~ '^[a-z0-9][a-z0-9-]*$');
ALTER TABLE "forms" ADD CONSTRAINT "forms_status_check" CHECK ("status" IN ('draft', 'live', 'closed'));
ALTER TABLE "forms" ADD CONSTRAINT "forms_response_count_check" CHECK ("response_count" >= 0);
ALTER TABLE "form_versions" ADD CONSTRAINT "form_versions_version_check" CHECK ("version" >= 1);
-- Answers are always a {fieldId: value} object (summary queries rely on jsonb_each).
ALTER TABLE "responses" ADD CONSTRAINT "responses_answers_object" CHECK (jsonb_typeof("answers") = 'object');
ALTER TABLE "form_events" ADD CONSTRAINT "form_events_type_check" CHECK ("type" IN ('view', 'start'));
ALTER TABLE "form_event_counts" ADD CONSTRAINT "form_event_counts_counts_check" CHECK ("views" >= 0 AND "starts" >= 0);
ALTER TABLE "user_prefs" ADD CONSTRAINT "user_prefs_key_check" CHECK ("key" ~ '^[a-z][a-zA-Z0-9_.-]{0,63}$');
ALTER TABLE "intelform_settings" ADD CONSTRAINT "intelform_settings_singleton" CHECK ("id" = 1);
ALTER TABLE "intelform_settings" ADD CONSTRAINT "intelform_settings_mode_check" CHECK ("default_mode" IN ('light', 'dark', 'system'));
ALTER TABLE "intelform_settings" ADD CONSTRAINT "intelform_settings_date_format_check"
  CHECK ("date_format" IN ('DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD', 'D MMM YYYY'));
ALTER TABLE "intelform_settings" ADD CONSTRAINT "intelform_settings_accent_check" CHECK ("accent_color" IS NULL OR "accent_color" ~ '^#[0-9a-fA-F]{6}$');
ALTER TABLE "intelform_settings" ADD CONSTRAINT "intelform_settings_retention_check"
  CHECK ("retention_days" IS NULL OR "retention_days" BETWEEN 1 AND 3650);

-- ---------------------------------------------------------------------------
-- Indexes Prisma's schema can't hold. A later `--create-only` migration may list
-- `DROP INDEX` for these: delete those lines before applying (docs/agent/database.md).
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Substring search across text answers (ILIKE on search_text).
CREATE INDEX "responses_search_trgm" ON "responses" USING gin ("search_text" gin_trgm_ops);
-- Choice filters on the Responses table (answers @> '{"f_x": "o_y"}').
CREATE INDEX "responses_answers" ON "responses" USING gin ("answers" jsonb_path_ops);
-- One response per browser.
CREATE INDEX "responses_browser" ON "responses" ("form_id", "browser_token") WHERE "browser_token" IS NOT NULL;
-- One response per email: the unique index is what stops two simultaneous submits.
CREATE UNIQUE INDEX "responses_email_key" ON "responses" ("form_id", "email_key") WHERE "email_key" IS NOT NULL;
-- Contacts: one contact's responses, newest first (grouping, detail, erase).
CREATE INDEX "responses_contact_key" ON "responses" ("contact_key", "submitted_at" DESC) WHERE "contact_key" IS NOT NULL;
-- Contacts: substring search on name, email and phone. Queries must use the same expression.
CREATE INDEX "responses_contact_search" ON "responses" USING gin (
  (coalesce("contact_name", '') || ' ' || coalesce("contact_email", '') || ' ' || coalesce("contact_phone", '')) gin_trgm_ops
) WHERE "contact_key" IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Contacts: a BEFORE trigger reads the response's form version and copies the first
-- non-empty email, name and phone answers into the contact_* columns, and builds
-- contact_key ("e:<email>", else "p:<E.164 phone>"). Code never writes these columns.
-- Fields are a flat array of {id, type, ...} (src/lib/intelform/form/definition.ts); email
-- answers are trimmed lowercase strings, names a string or {first, last}, phones E.164.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "responses_contact_fill"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  fields jsonb;
  f jsonb;
  v jsonb;
  t text;
  em text;
  nm text;
  ph text;
BEGIN
  SELECT definition -> 'fields' INTO fields FROM form_versions WHERE id = NEW.form_version_id;
  IF jsonb_typeof(fields) = 'array' AND jsonb_typeof(NEW.answers) = 'object' THEN
    FOR f IN SELECT value FROM jsonb_array_elements(fields) LOOP
      t := f ->> 'type';
      IF t IS NULL OR t NOT IN ('email', 'name', 'phone') OR jsonb_typeof(f -> 'id') <> 'string' THEN
        CONTINUE;
      END IF;
      v := NEW.answers -> (f ->> 'id');
      IF v IS NULL THEN
        CONTINUE;
      END IF;
      IF t = 'email' AND em IS NULL AND jsonb_typeof(v) = 'string' THEN
        em := lower(btrim(v #>> '{}'));
        IF em = '' OR length(em) > 254 OR em ~ '\s' OR position('@' IN em) = 0 THEN
          em := NULL;
        END IF;
      ELSIF t = 'phone' AND ph IS NULL AND jsonb_typeof(v) = 'string' THEN
        ph := regexp_replace(v #>> '{}', '[\s().-]', '', 'g');
        IF ph !~ '^\+[1-9][0-9]{6,14}$' THEN
          ph := NULL;
        END IF;
      ELSIF t = 'name' AND nm IS NULL THEN
        IF jsonb_typeof(v) = 'string' THEN
          nm := nullif(btrim(v #>> '{}'), '');
        ELSIF jsonb_typeof(v) = 'object' THEN
          nm := nullif(concat_ws(' ', nullif(btrim(v ->> 'first'), ''), nullif(btrim(v ->> 'last'), '')), '');
        END IF;
      END IF;
      EXIT WHEN em IS NOT NULL AND nm IS NOT NULL AND ph IS NOT NULL;
    END LOOP;
  END IF;
  NEW.contact_email := em;
  NEW.contact_name := left(nm, 200);
  NEW.contact_phone := ph;
  NEW.contact_key := CASE WHEN em IS NOT NULL THEN 'e:' || em WHEN ph IS NOT NULL THEN 'p:' || ph END;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS "responses_contact_fill" ON "responses";
CREATE TRIGGER "responses_contact_fill"
  BEFORE INSERT OR UPDATE OF "answers", "form_version_id" ON "responses"
  FOR EACH ROW EXECUTE FUNCTION "responses_contact_fill"();

-- Lenient timestamp parse for jsonb settings (forms.settings->>'closeAt'): a malformed date
-- must not break a whole query (the scheduled close, the public forms hub).
CREATE OR REPLACE FUNCTION "intelform_try_timestamptz"(value text) RETURNS timestamptz
LANGUAGE plpgsql STABLE AS $$
BEGIN
  RETURN value::timestamptz;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$;

-- ---------------------------------------------------------------------------
-- IntelForm's Editor and Viewer, as site roles (the Owner is the template's `owner`). The
-- catalogue (src/server/permissions.ts) grants them their site:form / site:response /
-- site:contact codenames on the first signed-in request after this deploy.
-- ---------------------------------------------------------------------------
INSERT INTO "roles" ("slug", "name", "description", "is_system", "updated_at") VALUES
  ('editor', 'Editor', 'Builds, edits and publishes forms; reads, exports and deletes responses and contacts.', false, CURRENT_TIMESTAMP),
  ('viewer', 'Viewer', 'Reads forms, responses and contacts, and exports them. Changes nothing.', false, CURRENT_TIMESTAMP)
ON CONFLICT ("slug") DO NOTHING;

-- The one app settings row, with its defaults.
INSERT INTO "intelform_settings" ("id") VALUES (1) ON CONFLICT ("id") DO NOTHING;

COMMIT;
