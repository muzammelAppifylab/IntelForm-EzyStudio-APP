import type {FormPatchInput, FormPatchResponse, FormStatus} from '../../../lib/intelform/api-forms';
import {clientSettings, formSettings, type FormSettings} from '../../../lib/intelform/form/settings';
import type {Prisma} from '../../../generated/prisma/client';
import type {PrismaClient} from '../../../platform/db';
import {hashPassword} from '../../../platform/auth/password';
import {normalizeDraft, parseTheme, readSettings} from './draft';
import {BuilderError, formGone, isUniqueViolation, zodFields} from './errors';
import {assertSafeUrl, UnsafeWebhookUrl} from './webhook-core';
import {webhookUrlPolicy} from './webhook-delivery';
import type {UrlPolicy} from '../webhooks/ssrf';

/**
 * Autosave: PATCH a form's title, slug, draft, theme and settings (only what was sent).
 *
 * Last save wins. The client sends the revision its edit was based on (`If-Match`); the save
 * always lands, bumps the revision, and says whether it replaced someone else's newer save
 * (`overwrote`, `overwrittenBy`) so the builder can show the banner. The row is locked for the
 * few statements of the save, so two saves never interleave.
 *
 * A slug change keeps the old slug in `form_slugs_old` (old links keep redirecting) and is
 * refused when another form uses it, now or as an old slug. A form may take back its own.
 */

export const slugTakenError = () =>
  new BuilderError(422, 'invalid_input', 'That link is taken', {slug: ['That link is already used by another form. Try another.']});

/** Validation and hashing done before the transaction, so the row lock stays short. */
export interface PreparedPatch {
  title?: string;
  slug?: string;
  draftJson?: string;
  themeJson?: string;
  settingsPatch?: Record<string, unknown>;
  /** undefined: unchanged; null: clear; string: the new hash. */
  passwordHash?: string | null;
}

export async function preparePatch(input: FormPatchInput, opts: {policy?: Partial<UrlPolicy>} = {}): Promise<PreparedPatch> {
  const out: PreparedPatch = {};
  if (input.title !== undefined) out.title = input.title;
  if (input.slug !== undefined) out.slug = input.slug;
  if (input.draft !== undefined) out.draftJson = JSON.stringify(normalizeDraft(input.draft));
  if (input.theme !== undefined) out.themeJson = JSON.stringify(parseTheme(input.theme));
  if (input.settings !== undefined) {
    const {password, ...rest} = input.settings;
    // SSRF: refuse private, loopback and local-name targets when saving, not only when sending.
    if (rest.webhook?.url) {
      try {
        assertSafeUrl(rest.webhook.url, opts.policy ?? webhookUrlPolicy());
      } catch (err) {
        if (err instanceof UnsafeWebhookUrl) {
          throw new BuilderError(422, 'invalid_input', err.message, {'settings.webhook.url': [err.message]});
        }
        throw err;
      }
    }
    out.settingsPatch = rest as Record<string, unknown>;
    if (password !== undefined) out.passwordHash = password === null ? null : await hashPassword(password);
  }
  return out;
}

/** Stored settings + a patch → validated settings, or a 422 naming the settings at fault. */
export function mergeSettings(current: FormSettings, patch: Record<string, unknown>, passwordHash?: string | null): FormSettings {
  const merged: Record<string, unknown> = {...current, ...patch};
  if (patch.webhook && typeof patch.webhook === 'object') merged.webhook = {...current.webhook, ...(patch.webhook as object)};
  if (passwordHash !== undefined) merged.passwordHash = passwordHash;
  const parsed = formSettings.safeParse(merged);
  if (!parsed.success) {
    throw new BuilderError(422, 'invalid_input', 'Check the highlighted settings', zodFields(parsed.error as never, 'settings'));
  }
  return parsed.data;
}

/** "Close form now" and the status move together. */
export function statusAfterSettings(
  status: FormStatus,
  before: FormSettings,
  after: FormSettings,
  published: boolean
): FormStatus {
  if (after.closed && status === 'live') return 'closed';
  if (!after.closed && before.closed && status === 'closed' && published) return 'live';
  return status;
}

interface LockedRow {
  title: string;
  slug: string;
  status: FormStatus;
  settings: unknown;
  revision: number;
  updated_by: number | null;
  updated_by_name: string | null;
  published_version_id: string | null;
}

type SaveArgs = {formId: string; patch: PreparedPatch; expected: number | null; userId: number};
type Tx = Pick<Prisma.TransactionClient, '$queryRaw' | '$executeRaw'>;

export async function saveFormPatch(db: PrismaClient, args: SaveArgs): Promise<FormPatchResponse> {
  try {
    return await db.$transaction(tx => saveInTx(tx, args));
  } catch (err) {
    // Two forms racing for the same new slug: the unique index decides.
    if (isUniqueViolation(err)) throw slugTakenError();
    throw err;
  }
}

/** The save itself, inside the caller's transaction (the form row stays locked until it ends). */
export async function saveInTx(tx: Tx, args: SaveArgs): Promise<FormPatchResponse> {
  const {formId: id, patch, expected, userId} = args;
  const [row] = await tx.$queryRaw<LockedRow[]>`
    SELECT f.title, f.slug, f.status, f.settings, f.revision, f.updated_by, u.name AS updated_by_name,
      f.published_version_id::text AS published_version_id
    FROM forms f LEFT JOIN users u ON u.id = f.updated_by
    WHERE f.id = ${id}::uuid
    FOR UPDATE OF f`;
  if (!row) throw formGone();

  const overwrote = expected !== null && expected !== row.revision;
  const overwrittenBy =
    overwrote && row.updated_by !== null && row.updated_by_name !== null
      ? {id: row.updated_by, name: row.updated_by_name}
      : null;

  let slug = row.slug;
  if (patch.slug !== undefined && patch.slug !== row.slug) {
    const [taken] = await tx.$queryRaw<{one: number}[]>`
      SELECT 1 AS one FROM forms WHERE slug = ${patch.slug} AND id <> ${id}::uuid
      UNION ALL
      SELECT 1 FROM form_slugs_old WHERE slug = ${patch.slug} AND form_id <> ${id}::uuid
      LIMIT 1`;
    if (taken) throw slugTakenError();
    await tx.$executeRaw`DELETE FROM form_slugs_old WHERE slug = ${patch.slug} AND form_id = ${id}::uuid`;
    await tx.$executeRaw`
      INSERT INTO form_slugs_old (slug, form_id) VALUES (${row.slug}, ${id}::uuid) ON CONFLICT (slug) DO NOTHING`;
    slug = patch.slug;
  }

  let settings: FormSettings | undefined;
  let status = row.status;
  if (patch.settingsPatch !== undefined || patch.passwordHash !== undefined) {
    const current = readSettings(row.settings);
    settings = mergeSettings(current, patch.settingsPatch ?? {}, patch.passwordHash);
    status = statusAfterSettings(row.status, current, settings, row.published_version_id !== null);
  }

  // The draft and theme go over the wire once (as n.*). On the right of SET, f.* is the row
  // before this update, so "changed since publish" compares old and new in the database.
  const [updated] = await tx.$queryRaw<{revision: number; has_unpublished: boolean; published: boolean}[]>`
    UPDATE forms f SET
      title = ${patch.title ?? row.title},
      slug = ${slug},
      status = ${status},
      draft = COALESCE(n.draft, f.draft),
      theme = COALESCE(n.theme, f.theme),
      settings = COALESCE(n.settings, f.settings),
      has_unpublished = f.has_unpublished
        OR (n.draft IS NOT NULL AND f.draft IS DISTINCT FROM n.draft)
        OR (n.theme IS NOT NULL AND f.theme IS DISTINCT FROM n.theme),
      revision = f.revision + 1,
      updated_by = ${userId},
      updated_at = now()
    FROM (SELECT ${patch.draftJson ?? null}::jsonb AS draft, ${patch.themeJson ?? null}::jsonb AS theme,
      ${settings ? JSON.stringify(settings) : null}::jsonb AS settings) n
    WHERE f.id = ${id}::uuid
    RETURNING f.revision, f.has_unpublished, (f.published_version_id IS NOT NULL) AS published`;
  if (!updated) throw formGone();

  return {
    revision: updated.revision,
    overwrote,
    overwrittenBy,
    hasUnpublished: updated.has_unpublished && updated.published,
    slug,
    status,
    ...(settings ? {settings: clientSettings(settings, {canEdit: true})} : {}),
  } satisfies FormPatchResponse;
}
