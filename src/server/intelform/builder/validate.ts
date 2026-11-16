import {validator} from 'hono/validator';
import type {z} from 'zod';

import {problem} from '../../../platform/guards';
import {zodFields} from './errors';

/**
 * A JSON body checked with a zod schema: 422 `invalid_input` with per-field messages, or the
 * parsed value as `c.req.valid('json')`. A missing or empty body counts as `{}`.
 */
export const zodJson = <S extends z.ZodType>(schema: S, message = 'Check the highlighted fields.') =>
  validator('json', (value, c) => {
    const parsed = schema.safeParse(value ?? {});
    if (!parsed.success) {
      return c.json({...problem('invalid_input', message), fields: zodFields(parsed.error)}, 422);
    }
    return parsed.data as z.output<S>;
  });
