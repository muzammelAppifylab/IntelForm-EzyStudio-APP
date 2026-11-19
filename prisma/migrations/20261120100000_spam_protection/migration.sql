-- Spam protection (submit flooding, response-cap exhaustion, confirmation-email abuse):
--  * intelform_settings.spam_limits: the site's ceilings (submits a minute across every form,
--    confirmation emails a day) and the defaults new forms start with. '{}' = the built-in
--    defaults (src/lib/intelform/spam.ts), so nothing changes for a site until it saves.
--  * intelform_blocked_ips: address blocks refused at the submit gate, by the keyed hash of the
--    block (never the raw address as the key). `ip_block` is the block itself (an IPv4 address or
--    an IPv6 /64), shown in full only to people who may change the app settings. Automatic blocks
--    escalate 1 hour, 24 hours, 7 days (`blocks`); rows are kept 30 days after they expire so a
--    repeat offender escalates, then removed.
BEGIN;

ALTER TABLE "intelform_settings" ADD COLUMN "spam_limits" JSONB NOT NULL DEFAULT '{}';

CREATE TABLE "intelform_blocked_ips" (
    "ip_key" VARCHAR(40) NOT NULL,
    "ip_block" VARCHAR(64),
    "reason" VARCHAR(32) NOT NULL,
    "hits" INTEGER NOT NULL DEFAULT 0,
    "blocks" INTEGER NOT NULL DEFAULT 1,
    "form_id" UUID,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "intelform_blocked_ips_pkey" PRIMARY KEY ("ip_key")
);
CREATE INDEX "intelform_blocked_ips_expires_at_idx" ON "intelform_blocked_ips"("expires_at");
CREATE INDEX "intelform_blocked_ips_updated_at_ip_key_idx" ON "intelform_blocked_ips"("updated_at", "ip_key");
CREATE INDEX "intelform_blocked_ips_created_by_idx" ON "intelform_blocked_ips"("created_by");

ALTER TABLE "intelform_blocked_ips" ADD CONSTRAINT "intelform_blocked_ips_form_id_fkey"
  FOREIGN KEY ("form_id") REFERENCES "forms"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "intelform_blocked_ips" ADD CONSTRAINT "intelform_blocked_ips_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT;
