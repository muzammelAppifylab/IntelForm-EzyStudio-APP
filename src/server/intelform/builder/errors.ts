import type {Context} from 'hono';
import type {ContentfulStatusCode} from 'hono/utils/http-status';
import type {z} from 'zod';

import {problem} from '../../../platform/guards';

/**
 * An answer the builder routes give in words (`{error, message, fields?, …}`), thrown from the
 * helpers in this folder and turned into JSON by `builderError()`. Anything else that is thrown
 * is a real bug: the app's `onError` answers 500 `internal_error`.
 */
export class BuilderError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string[]>,
    /** Extra keys for the body (`issues` on a blocked publish). */
    readonly extra?: Record<string, unknown>,
    readonly headers?: Record<string, string>
  ) {
    super(message);
    this.name = 'BuilderError';
  }
}

export const GONE = 'That form no longer exists';
export const formGone = () => new BuilderError(404, 'not_found', GONE);

/** The JSON body of a BuilderError, in the template's `problem()` shape. */
export function errorBody(err: BuilderError): Record<string, unknown> {
  return {...problem(err.code, err.message), ...(err.fields ? {fields: err.fields} : {}), ...(err.extra ?? {})};
}

/** Answers a BuilderError; rethrows anything else (the app's onError logs it and answers 500). */
export function builderError(c: Context, err: unknown): Response {
  if (!(err instanceof BuilderError)) throw err;
  for (const [k, v] of Object.entries(err.headers ?? {})) c.header(k, v);
  return c.json(errorBody(err), err.status);
}

/** Zod issues as `{'prefix.path': [messages]}`, at most 20. */
export function zodFields(error: z.ZodError, prefix?: string): Record<string, string[]> {
  const fields: Record<string, string[]> = {};
  for (const issue of error.issues.slice(0, 20)) {
    const key = [...(prefix ? [prefix] : []), ...issue.path.map(String)].join('.') || (prefix ?? 'body');
    (fields[key] ??= []).push(issue.message);
  }
  return fields;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A uuid path parameter, lower-cased; null when it can't be one (answer 404: no oracle). */
export function uuidOrNull(value: string | undefined): string | null {
  return value && UUID_RE.test(value) ? value.toLowerCase() : null;
}

/**
 * A unique-constraint violation, however the driver reports it: Prisma's `P2002`, a raw query's
 * `P2010` carrying Postgres `23505`, or a driver error with `originalCode`.
 */
export function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as {code?: unknown; originalCode?: unknown; meta?: {code?: unknown; driverAdapterError?: {cause?: {originalCode?: unknown; kind?: unknown}}}; cause?: unknown};
  if (e.code === 'P2002' || e.code === '23505' || e.originalCode === '23505') return true;
  if (e.meta?.code === '23505') return true;
  const cause = e.meta?.driverAdapterError?.cause;
  if (cause?.originalCode === '23505' || cause?.kind === 'UniqueConstraintViolation') return true;
  if (e.cause && e.cause !== err) return isUniqueViolation(e.cause);
  return false;
}
