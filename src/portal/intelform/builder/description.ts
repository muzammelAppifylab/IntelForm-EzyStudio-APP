import type {FormField} from '../../../lib/intelform/form/definition';
import {DESCRIPTION_HTML_MAX, DESCRIPTION_TEXT_MAX, descriptionToHtml} from '../../../lib/intelform/form/rich-text';

/**
 * Question descriptions in the builder are rich text. An older plain description opens as
 * paragraphs and is saved as rich text on its first edit.
 */
export const DESCRIPTION_LIMITS = {maxLength: DESCRIPTION_HTML_MAX, maxTextLength: DESCRIPTION_TEXT_MAX} as const;

export function descriptionValue(f: Pick<FormField, 'description' | 'descriptionFormat'>): string {
  return descriptionToHtml(f.description, f.descriptionFormat);
}

/** Store the editor's HTML ('' clears the description). */
export function applyDescription(f: FormField, html: string): void {
  if (html) {
    f.description = html;
    f.descriptionFormat = 'html';
  } else {
    delete f.description;
    delete f.descriptionFormat;
  }
}
