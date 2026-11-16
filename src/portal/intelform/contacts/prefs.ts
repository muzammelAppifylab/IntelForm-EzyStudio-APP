import {useCallback, useState} from 'react';

/** Per-viewer conveniences for the Contacts screen (this browser only; the screen works without them). */

export const COLUMNS = ['phone', 'country', 'forms', 'responses', 'firstSeen', 'lastSeen'] as const;
export type ColumnId = (typeof COLUMNS)[number];
export const COLUMN_LABEL: Record<ColumnId, string> = {
  phone: 'Phone',
  country: 'Country',
  forms: 'Forms',
  responses: 'Responses',
  firstSeen: 'First seen',
  lastSeen: 'Last active',
};

const COLUMNS_KEY = 'intelform.contacts.hiddenColumns';

/** Reads the stored hidden columns, keeping only known ones. */
export function parseHidden(stored: string | null): ColumnId[] {
  try {
    const parsed: unknown = JSON.parse(stored ?? '[]');
    return Array.isArray(parsed) ? COLUMNS.filter(c => parsed.includes(c)) : [];
  } catch {
    return [];
  }
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage blocked: the choice lasts for this visit only.
  }
}

export function useHiddenColumns(): [ColumnId[], (cols: ColumnId[]) => void] {
  const [hidden, setHidden] = useState<ColumnId[]>(() => parseHidden(read(COLUMNS_KEY)));
  const change = useCallback((cols: ColumnId[]) => {
    setHidden(cols);
    write(COLUMNS_KEY, JSON.stringify(cols));
  }, []);
  return [hidden, change];
}
