import {answerToCsv} from '../../../lib/intelform/form/csv';
import type {FormDefinition, FormField} from '../../../lib/intelform/form/definition';
import {answerPlainText} from '../../../lib/intelform/form/rich-text';
import {coreRegistry} from '../../../lib/intelform/form/types/registry';

/** Human-readable answer text, one line per CSV cell (emails, redirect parameters). */
export function answerText(field: FormField, value: unknown): string {
  return answerToCsv(field, value)
    .filter(c => c !== '')
    .join(', ');
}

/** Stored fields with an answer, in form order. */
export function answeredFields(def: FormDefinition, answers: Record<string, unknown>): FormField[] {
  return def.fields.filter(f => coreRegistry[f.type].stores && answers[f.id] !== undefined);
}

/**
 * Redirect after submit, with answers appended as query parameters (keyed by field id) when
 * that setting is on. Signatures are never appended.
 */
export function redirectWithAnswers(base: string, def: FormDefinition, answers: Record<string, unknown>, append: boolean): string {
  const url = new URL(base);
  if (append) {
    for (const f of answeredFields(def, answers)) {
      if (f.type === 'signature') continue;
      url.searchParams.set(f.id, answerText(f, answers[f.id]));
    }
  }
  return url.toString();
}

/** Types whose text goes into responses.search_text. */
const SEARCH_TEXT_TYPES = new Set<string>(['name', 'email', 'phone', 'url', 'short_text', 'long_text', 'address']);

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * `responses.search_text` for one submission: text answers (name, email, phone, URL, short and
 * long text, address) plus "Other" text, newline-separated, at most 20,000 characters. Same rules
 * as the responses domain's display text (name: parts joined by spaces, address: by commas).
 */
export function buildSearchText(fields: readonly FormField[], answers: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const f of fields) {
    const v = answers[f.id];
    if (v === undefined || v === null) continue;
    if (SEARCH_TEXT_TYPES.has(f.type)) {
      const t =
        f.type === 'name'
          ? answerToCsv(f, v).filter(Boolean).join(' ') || (typeof v === 'string' ? v : '')
          : f.type === 'address'
            ? answerToCsv(f, v).filter(Boolean).join(', ')
            : answerPlainText(v);
      if (t) parts.push(t);
    } else if (isRecord(v) && typeof v.other === 'string' && v.other) {
      parts.push(v.other);
    } else if (Array.isArray(v)) {
      for (const x of v) if (isRecord(x) && typeof x.other === 'string' && x.other) parts.push(x.other);
    }
  }
  return parts.join('\n').slice(0, 20_000);
}
