import type {FormField} from '../../../lib/intelform/form/definition';
import type {FieldType} from '../../../lib/intelform/form/field-types';
import {answerToCsv} from '../../../lib/intelform/form/csv';
import {countryName, formatDate, formatTime, isIsoDate, isTime} from '../../../lib/intelform/form/types/registry';
import {isUploadedFileUrl} from '../../../lib/intelform/settings-app';

/**
 * Answer → display text for the table, the drawer and the summary's latest answers.
 * Built on the registry's CSV cells, so labels and joins match the export.
 */

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A stored file id: `/__platform/files/<id>/<name>`. */
const FILE_ID = /^\/__platform\/files\/([A-Za-z0-9_-]{1,100})\//;

/**
 * The URL of a signature answer, only when it is `{url}` pointing at a file this site stored
 * (`/__platform/files/<id>/<name>`, the platform's public file link). Anything else (free text
 * kept from before the field became a signature, an outside URL that would log every viewer's
 * address) is not a signature and must never become a link or an image in the dashboard.
 */
export function storedSignatureUrl(value: unknown): string | null {
  const url = isRecord(value) ? value.url : undefined;
  return typeof url === 'string' && isUploadedFileUrl(url) ? url : null;
}

/** The platform file id of a stored file URL, or null. */
export function fileIdFromUrl(url: unknown): string | null {
  if (typeof url !== 'string' || !isUploadedFileUrl(url)) return null;
  return FILE_ID.exec(url)?.[1] ?? null;
}

export interface DisplayValue {
  text: string;
  url?: string;
}

export function displayAnswer(field: FormField, value: unknown): DisplayValue {
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
      const url = storedSignatureUrl(value);
      if (url) return {text: 'Signed', url};
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
