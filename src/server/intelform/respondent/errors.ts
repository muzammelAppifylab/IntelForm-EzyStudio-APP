import type {Context} from 'hono';
import type {ContentfulStatusCode} from 'hono/utils/http-status';

import {problem} from '../../../platform/guards';

/**
 * An answer the respondent routes give in words: `{error, message, fields?}` (the template's
 * `problem()` shape, src/lib/intelform/api.ts ApiErrorBody). Thrown inside the respondent
 * pipeline and turned into JSON by `respondentError()` in the route; anything else is a 500
 * through the app's `onError`.
 */
export class RespondentError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: string,
    message: string,
    /** Field id → messages (422 `validation_failed`, or `password` on unlock). */
    readonly fields?: Record<string, string[]>,
    readonly headers?: Record<string, string>
  ) {
    super(message);
    this.name = 'RespondentError';
  }
}

export const notFound = (message = 'This form doesn’t exist.') => new RespondentError(404, 'not_found', message);

/** The JSON answer for a RespondentError; rethrows anything else (the app's onError answers 500). */
export function respondentError(c: Context, err: unknown): Response {
  if (!(err instanceof RespondentError)) throw err;
  for (const [k, v] of Object.entries(err.headers ?? {})) c.header(k, v);
  c.header('Cache-Control', 'no-store');
  const body = err.fields ? {...problem(err.code, err.message), fields: err.fields} : problem(err.code, err.message);
  return c.json(body, err.status);
}

/** `{fieldId: message}` → `{fieldId: [message]}`. */
export const fieldErrors = (errors: Record<string, string>): Record<string, string[]> =>
  Object.fromEntries(Object.entries(errors).map(([k, v]) => [k, [v]]));
