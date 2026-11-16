import {validator} from 'hono/validator';
import {z} from 'zod';

import {problem} from '../../../platform/guards';

/** RFC 4122-shaped ids (the `gen_random_uuid()` keys of IntelForm's tables). */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (value: string | undefined | null): value is string => typeof value === 'string' && UUID_RE.test(value);

/** zod field errors as `{field: [messages]}`, keyed by the top-level input name. */
export function zodFieldErrors(error: z.ZodError): Record<string, string[]> {
  const {fieldErrors} = z.flattenError(error);
  const out: Record<string, string[]> = {};
  for (const [key, messages] of Object.entries(fieldErrors as Record<string, string[] | undefined>)) {
    if (messages?.length) out[key] = messages;
  }
  return out;
}

/**
 * A JSON body validator from a zod schema. A bad body answers
 * `422 {error: 'validation_failed', message, fields}` (the legacy `readBody` shape, kept so the
 * dashboard's useFormErrors shows the messages in place).
 */
export const zodJson = <T extends z.ZodType>(schema: T) =>
  validator('json', (value, c) => {
    const result = schema.safeParse(value);
    if (!result.success) {
      const {formErrors} = z.flattenError(result.error);
      return c.json(
        {...problem('validation_failed', formErrors[0] ?? 'Check the highlighted fields'), fields: zodFieldErrors(result.error)},
        422
      );
    }
    return result.data as z.output<T>;
  });
