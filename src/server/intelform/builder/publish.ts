import type {FormStatus, PublishResponse} from '../../../lib/intelform/api-forms';
import {Prisma} from '../../../generated/prisma/client';
import {exactResponsesSql} from '../forms/counts';
import {writeCatalogAtPublish} from '../responses/catalog';
import {publishCheck, readTheme} from './draft';
import {formGone} from './errors';

type Tx = Pick<Prisma.TransactionClient, '$queryRaw' | '$executeRaw'>;

interface PublishRow {
  draft: unknown;
  theme: unknown;
  settings: unknown;
  status: FormStatus;
  revision: number;
  response_count: number;
  has_unpublished: boolean;
  published_version_id: string | null;
}

/** The exact response count for the header the answer updates (forms.response_count is a minute-old copy). */
const EXACT_COUNT = exactResponsesSql(Prisma.sql`forms.id`);

/**
 * Publish: copies the draft and theme into a new `form_versions` row (1, 2, 3… per form) and
 * makes it the live version. Runs inside the caller's transaction (plain, or `idempotent()` when
 * the client sent an `Idempotency-Key`), with the form row locked, so two publishes never race;
 * the unique (form_id, version) index is the last guard.
 *
 * Idempotent on its own too: when nothing changed since the live version (no unpublished
 * changes), a repeat answers the live version instead of writing an identical one.
 *
 * The field catalog the responses screens and exports read (form_catalogs) is updated in the
 * same transaction from the previous one (responses/catalog.ts `writeCatalogAtPublish`).
 *
 * Refusals throw a 422 BuilderError (`invalid_input` with fields, `empty_form`, or
 * `logic_issues` with `issues`), which rolls the transaction back.
 */
export async function publishInTx(tx: Tx, formId: string, userId: number): Promise<PublishResponse> {
  // Lock the form row ON ITS OWN first. A locking SELECT that also joins form_versions is not
  // safe: under READ COMMITTED a publish that waited for the lock re-reads the form row (now
  // pointing at the version the other publish just wrote) but re-checks the join against its old
  // snapshot, so the join comes back empty, the "nothing changed" check fails and it writes an
  // identical duplicate version (pushing mid-form respondents past the one-version grace).
  const [row] = await tx.$queryRaw<PublishRow[]>`
    SELECT draft, theme, settings, status, revision, ${EXACT_COUNT} AS response_count, has_unpublished,
      published_version_id::text AS published_version_id
    FROM forms
    WHERE id = ${formId}::uuid
    FOR UPDATE`;
  if (!row) throw formGone();

  const checked = publishCheck(row.draft, row.settings);
  if (!checked.ok) throw checked.error;

  // Holding the lock, a new statement sees the latest committed version.
  if (row.published_version_id !== null && !row.has_unpublished) {
    const [live] = await tx.$queryRaw<{version: number; published_at: Date}[]>`
      SELECT version, published_at FROM form_versions WHERE id = ${row.published_version_id}::uuid`;
    if (live) {
      return {
        version: live.version,
        publishedAt: new Date(live.published_at).toISOString(),
        status: row.status,
        revision: row.revision,
        responses: row.response_count,
      };
    }
  }

  // A closed form stays closed: publishing a fix must not reopen it by surprise. Reopen does that.
  const status: FormStatus = row.status === 'closed' ? 'closed' : 'live';
  const [version] = await tx.$queryRaw<{id: string; version: number; published_at: Date}[]>`
    INSERT INTO form_versions (form_id, version, definition, theme, published_by)
    SELECT ${formId}::uuid, COALESCE(max(version), 0) + 1, ${JSON.stringify(checked.definition)}::jsonb,
      ${JSON.stringify(readTheme(row.theme))}::jsonb, ${userId}::int
    FROM form_versions WHERE form_id = ${formId}::uuid
    RETURNING id::text AS id, version, published_at`;
  // The responses catalog (form_catalogs) moves on with it, merged in O(fields), same transaction.
  await writeCatalogAtPublish(tx, formId, row.published_version_id, version!, checked.definition.fields);
  const [after] = await tx.$queryRaw<{revision: number; response_count: number}[]>`
    UPDATE forms SET
      published_version_id = ${version!.id}::uuid,
      status = ${status},
      has_unpublished = false,
      revision = revision + 1,
      updated_by = ${userId},
      updated_at = now()
    WHERE id = ${formId}::uuid
    RETURNING revision, ${EXACT_COUNT} AS response_count`;
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
