import type {FormStatus, PublishResponse} from '../../../lib/intelform/api-forms';
import type {Prisma} from '../../../generated/prisma/client';
import {publishCheck, readTheme} from './draft';
import {formGone} from './errors';

type Tx = Pick<Prisma.TransactionClient, '$queryRaw'>;

interface PublishRow {
  draft: unknown;
  theme: unknown;
  settings: unknown;
  status: FormStatus;
  revision: number;
  response_count: number;
  has_unpublished: boolean;
  published_version: number | null;
  published_at: Date | null;
}

/**
 * Publish: copies the draft and theme into a new `form_versions` row (1, 2, 3… per form) and
 * makes it the live version. Runs inside the caller's transaction (plain, or `idempotent()` when
 * the client sent an `Idempotency-Key`), with the form row locked, so two publishes never race;
 * the unique (form_id, version) index is the last guard.
 *
 * Idempotent on its own too: when nothing changed since the live version (no unpublished
 * changes), a repeat answers the live version instead of writing an identical one.
 *
 * Refusals throw a 422 BuilderError (`invalid_input` with fields, `empty_form`, or
 * `logic_issues` with `issues`), which rolls the transaction back.
 */
export async function publishInTx(tx: Tx, formId: string, userId: number): Promise<PublishResponse> {
  const [row] = await tx.$queryRaw<PublishRow[]>`
    SELECT f.draft, f.theme, f.settings, f.status, f.revision, f.response_count, f.has_unpublished,
      v.version AS published_version, v.published_at
    FROM forms f LEFT JOIN form_versions v ON v.id = f.published_version_id
    WHERE f.id = ${formId}::uuid
    FOR UPDATE OF f`;
  if (!row) throw formGone();

  const checked = publishCheck(row.draft, row.settings);
  if (!checked.ok) throw checked.error;

  if (row.published_version !== null && row.published_at && !row.has_unpublished) {
    return {
      version: row.published_version,
      publishedAt: new Date(row.published_at).toISOString(),
      status: row.status,
      revision: row.revision,
      responses: row.response_count,
    };
  }

  // A closed form stays closed: publishing a fix must not reopen it by surprise. Reopen does that.
  const status: FormStatus = row.status === 'closed' ? 'closed' : 'live';
  const [version] = await tx.$queryRaw<{id: string; version: number; published_at: Date}[]>`
    INSERT INTO form_versions (form_id, version, definition, theme, published_by)
    SELECT ${formId}::uuid, COALESCE(max(version), 0) + 1, ${JSON.stringify(checked.definition)}::jsonb,
      ${JSON.stringify(readTheme(row.theme))}::jsonb, ${userId}::int
    FROM form_versions WHERE form_id = ${formId}::uuid
    RETURNING id::text AS id, version, published_at`;
  const [after] = await tx.$queryRaw<{revision: number; response_count: number}[]>`
    UPDATE forms SET
      published_version_id = ${version!.id}::uuid,
      status = ${status},
      has_unpublished = false,
      revision = revision + 1,
      updated_by = ${userId},
      updated_at = now()
    WHERE id = ${formId}::uuid
    RETURNING revision, response_count`;
  return {
    version: version!.version,
    publishedAt: new Date(version!.published_at).toISOString(),
    status,
    revision: after!.revision,
    responses: after!.response_count,
  };
}

export interface VersionSummary {
  version: number;
  publishedAt: string;
  publishedBy: {id: number; name: string} | null;
  /** True for the version respondents get now. */
  live: boolean;
}

export interface VersionsResponse {
  versions: VersionSummary[];
}

export interface VersionDetail {
  version: number;
  publishedAt: string;
  definition: unknown;
  theme: unknown;
}
