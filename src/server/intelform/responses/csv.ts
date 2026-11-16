import type {FormField} from '../../../lib/intelform/form/definition';
import {answerToCsv, csvHeaders} from '../../../lib/intelform/form/csv';
import type {FormCatalog} from './catalog';
import {CSV_BOM, csvRow, type CsvCell} from './csv-text';
import {displayAnswer} from './format';

/**
 * CSV for one form ("CSV export"): BOM, one column per field (split name and address use
 * several, via csvHeaders), multiple choice joined with "; ", signature as its URL, then
 * submitted at, completion time, device, browser, country and response id.
 *
 * The rows are read by the export job (../exports/builders.ts), a bounded batch at a time.
 */

/**
 * One field's cells. A signature column holds the guarded view link of a file this site stored
 * (sign-in and site:response:read needed to open it), made absolute on `origin` when known.
 */
function csvCells(field: FormField, value: unknown, responseId: string, origin: string | null): CsvCell[] {
  if (field.type !== 'signature' || value === undefined || value === null) return answerToCsv(field, value);
  const d = displayAnswer(field, value, responseId);
  if (!d.url) return [d.text];
  return [origin ? origin.replace(/\/+$/, '') + d.url : d.url];
}

const META_HEADERS = ['Submitted at', 'Completion time (seconds)', 'Device', 'Browser', 'Country', 'Response ID'];

export function headerRow(cat: FormCatalog): string {
  const fieldHeaders = cat.entries.flatMap(e => {
    const hs = csvHeaders(e.plain);
    return e.meta.deleted ? hs.map(h => `${h} (deleted)`) : hs;
  });
  return csvRow([...fieldHeaders, ...META_HEADERS]);
}

export interface CsvRowData {
  id: string;
  submitted: string;
  duration_ms: number | null;
  device: string | null;
  browser: string | null;
  country: string | null;
  answers: Record<string, unknown>;
}

/** One data line. Exported for unit tests. `origin` makes signature links absolute. */
export function dataRow(cat: FormCatalog, r: CsvRowData, origin: string | null = null): string {
  const answers = r.answers && typeof r.answers === 'object' && !Array.isArray(r.answers) ? r.answers : {};
  const cells: CsvCell[] = cat.entries.flatMap(e => csvCells(e.plain, answers[e.meta.id], r.id, origin));
  const ms = r.duration_ms === null ? null : Number(r.duration_ms);
  cells.push(r.submitted, ms === null ? null : Math.round(ms / 100) / 10, r.device, r.browser, r.country, r.id);
  return csvRow(cells);
}

export function csvFilename(cat: {title: string; slug: string}, today: string): string {
  const base =
    (cat.title || cat.slug)
      .replace(/[\\/:*?"<>|\r\n]+/g, ' ')
      .trim()
      .slice(0, 80) || 'responses';
  return `${base} responses ${today}.csv`;
}
