/**
 * CSV for Excel, Numbers and Google Sheets: a UTF-8 BOM, CRLF line endings, RFC 4180 quoting,
 * and formula-injection escaping (OWASP) for text cells only, so negative numbers stay numbers.
 */
export const CSV_BOM = '\uFEFF'
export const CSV_EOL = '\r\n'

/** A cell value. Numbers, booleans and dates are never formula-escaped. */
export type CsvCell = string | number | boolean | Date | null | undefined

const FORMULA_START = /^[=+\-@\t\r]/
const NEEDS_QUOTES = /[",\r\n]/

export function csvEscape(value: CsvCell): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : value.toISOString()
  let s = String(value)
  // A text cell starting with = + - @ tab or CR would run as a formula in a spreadsheet.
  if (FORMULA_START.test(s)) s = `'${s}`
  return NEEDS_QUOTES.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** One line, CRLF included. */
export function csvRow(cells: readonly CsvCell[]): string {
  return cells.map(csvEscape).join(',') + CSV_EOL
}

/** `Content-Disposition` for a download, with an ASCII fallback and the UTF-8 name. */
export function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}
