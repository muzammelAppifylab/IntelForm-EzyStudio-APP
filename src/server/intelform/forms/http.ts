import type {Context} from 'hono';
import {validator} from 'hono/validator';
import {z} from 'zod';

import {problem} from '../../../platform/guards';
import {FormsError, GONE, isUuid, zodFields} from './core';

/** Hono glue for the forms routes: body and `:id` validators, and the error answer. */

/**
 * A JSON body checked by a zod schema. A bad body answers
 * `422 {error: 'validation_failed', message, fields}` so forms show the messages in place.
 */
export const zodJson = <T extends z.ZodType>(schema: T) =>
  validator('json', (value, c) => {
    const result = schema.safeParse(value);
    if (!result.success) {
      const first = result.error.issues.find(i => i.path.length === 0)?.message;
      return c.json({...problem('validation_failed', first ?? 'Check the highlighted fields'), fields: zodFields(result.error)}, 422);
    }
    return result.data as z.output<T>;
  });

/** `:id` must be a form uuid; anything else is the same 404 as a deleted form. */
export const formIdParam = validator('param', (value, c) => {
  const id = (value as {id?: string}).id;
  if (!isUuid(id)) return c.json(problem('not_found', GONE), 404);
  return {id: id.toLowerCase()};
});

/** A FormsError as its JSON answer; anything else goes on to the app's 500. */
export function fail(c: Context, err: unknown): Response {
  if (err instanceof FormsError) return c.json(err.body(), err.status);
  throw err;
}
