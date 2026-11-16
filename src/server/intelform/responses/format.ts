import type {FormField} from '../../../lib/intelform/form/definition';
import type {FieldType} from '../../../lib/intelform/form/field-types';
import {answerToCsv} from '../../../lib/intelform/form/csv';
import {countryName, formatDate, formatTime, isIsoDate, isTime} from '../../../lib/intelform/form/types/registry';
import {signatureViewPath, storedSignatureFileId} from '../uploads/signatures';

/**
 * Answer → display text for the table, the drawer and the summary's latest answers.
 * Built on the registry's CSV cells, so labels and joins match the export.
 */

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * A signature answer is "signed" only when it holds a file this site stored (`{fileId}`, or the
 * older `{url: "/__platform/files/<id>/…"}`). Its link is never the file: it is the guarded
 * view route (RESPONSE_READ, a 5-minute link per view), so a forwarded CSV or email never opens
 * it without a sign-in. Anything else (free text kept from before the field became a signature,
 * an outside URL that would log every viewer's address) never becomes a link or an image.
 */
export function signatureLinkFor(value: unknown, responseId: string | undefined, fieldId: string): string | null {
  if (!storedSignatureFileId(value)) return null;
  return responseId ? signatureViewPath(responseId, fieldId) : null;
}

export interface DisplayValue {
  text: string;
  url?: string;
}

/** `responseId` makes a signature's link (the guarded view route); without it a signature is just "Signed". */
export function displayAnswer(field: FormField, value: unknown, responseId?: string): DisplayValue {
  if (value === undefined || value === null) return {text: ''};
  switch (field.type) {
    case 'section_break':
      return {text: ''};
    case 'name':
      return {
        text: answerToCsv(field, value).filter(Boolean).join(' ') || (typeof value === 'string' ? value : ''),
      };
    case 'address':
      return {text: answerToCsv(field, value).filter(Boolean).join(', ')};
    case 'country':
      return {
        text: typeof value === 'string' && value ? countryName(value) : '',
      };
    case 'date':
      return {
        text: isIsoDate(value) ? formatDate(value, field.props.format) : '',
      };
    case 'time':
      return {
        text: isTime(value) ? formatTime(value, field.props.hourCycle) : '',
      };
    case 'consent':
      return {
        text: isRecord(value) && value.accepted === true ? 'Accepted' : '',
      };
    case 'signature': {
      if (storedSignatureFileId(value)) {
        const url = signatureLinkFor(value, responseId, field.id);
        return url ? {text: 'Signed', url} : {text: 'Signed'};
      }
      return {text: typeof value === 'string' ? value : ''};
    }
    default:
      return {text: answerToCsv(field, value).join('; ')};
  }
}

/** Types whose text goes into responses.search_text. */
export const SEARCH_TEXT_TYPES = new Set<FieldType>(['name', 'email', 'phone', 'url', 'short_text', 'long_text', 'address']);

/**
 * `responses.search_text` for one submission: text answers (name, email, phone, URL, short and
 * long text, address) plus "Other" text, newline-separated. The submit route stores this.
 */
export function buildSearchText(fields: readonly FormField[], answers: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const f of fields) {
    const v = answers[f.id];
    if (v === undefined || v === null) continue;
    if (SEARCH_TEXT_TYPES.has(f.type)) {
      const t = f.type === 'name' || f.type === 'address' ? displayAnswer(f, v).text : typeof v === 'string' ? v : '';
      if (t) parts.push(t);
    } else if (isRecord(v) && typeof v.other === 'string' && v.other) {
      parts.push(v.other);
    } else if (Array.isArray(v)) {
      for (const x of v) if (isRecord(x) && typeof x.other === 'string' && x.other) parts.push(x.other);
    }
  }
  return parts.join('\n').slice(0, 20_000);
}
