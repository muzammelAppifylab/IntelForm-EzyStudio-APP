import type * as z from 'zod';

/**
 * Reading the contacts query strings into the shared schemas (src/lib/intelform/api-contacts.ts).
 * Repeated keys (`form`, `country`, `has`, `key`) become arrays; empty values are dropped.
 */

export const ARRAY_KEYS = new Set(['form', 'country', 'has', 'key']);
export const FILTER_KEYS = ['q', 'segment', 'form', 'country', 'has', 'from', 'to', 'tz', 'min', 'max', 'sort', 'dir'];
export const LIST_KEYS = [...FILTER_KEYS, 'cursor', 'before', 'last', 'size'];
export const CSV_KEYS = [...FILTER_KEYS, 'key'];

export type Parsed<T> = {ok: true; data: T} | {ok: false; message: string; fields: Record<string, string>};

/** `value` as Hono's query validator hands it over: one string, or an array for a repeated key. */
export function rawQuery(value: Record<string, string | string[] | undefined>, keys: readonly string[]): Record<string, unknown> {
  const raw: Record<string, unknown> = {};
  for (const k of keys) {
    const v = value[k];
    const list = v === undefined ? [] : Array.isArray(v) ? v : [v];
    if (ARRAY_KEYS.has(k)) raw[k] = list.filter(x => x !== '');
    else {
      const first = list[0];
      if (first !== undefined && first !== '') raw[k] = first;
    }
  }
  return raw;
}

/** Parses with `schema`; on failure the first message, and one message per field. */
export function parseWith<S extends z.ZodType>(schema: S, raw: unknown): Parsed<z.infer<S>> {
  const parsed = schema.safeParse(raw);
  if (parsed.success) return {ok: true, data: parsed.data};
  const fields: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    const k = String(issue.path[0] ?? 'query');
    fields[k] ??= issue.message;
  }
  const first = parsed.error.issues[0];
  const message = first ? `${first.path.join('.') || 'query'}: ${first.message}` : 'Check the filters.';
  return {ok: false, message, fields};
}
