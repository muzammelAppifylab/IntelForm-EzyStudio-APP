-- Admins may create, edit and delete roles (the owner's decision, 2026-11-18).
-- Data only, IDEMPOTENT, matched by slug / codename (never by id). Anti-escalation still holds
-- in the admin API: an admin only grants, edits or deletes what they hold themselves, and never
-- touches the owner role.
BEGIN;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r
JOIN "permissions" p ON p."codename" = 'site:role:update'
WHERE r."slug" = 'admin'
ON CONFLICT DO NOTHING;

-- The admin role's description still named the job board this site no longer has.
-- Only the original wording is replaced: a description the owner wrote stays.
UPDATE "roles"
SET "description" = 'Manages users and roles, the forms app and its settings, and reads the activity log.',
    "updated_at" = CURRENT_TIMESTAMP
WHERE "slug" = 'admin'
  AND "description" = 'Manages users, jobs and reads the activity log.';

COMMIT;
