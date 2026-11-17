import {readFileSync} from 'node:fs';

import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it} from 'vitest';

import {comboboxControl, controlProps, type FocusableDocument, focusFirstInvalid} from '../../src/portal/intelform/lib/form-errors';
import {Field} from '../../src/portal/ui';

/**
 * F-042: the app's settings forms (useFormErrors) link each error to its field with
 * aria-describedby and focus the first wrong field on a failed save.
 */

/** A fake document: elements in page order; compareDocumentPosition from that order. */
function fakeDoc(order: string[]) {
  const focused: string[] = [];
  const el = (id: string) => ({
    focus: () => void focused.push(id),
    compareDocumentPosition: (other: {id: string}) => (order.indexOf(other.id) > order.indexOf(id) ? 4 : 2),
    id,
  });
  const els = new Map(order.map(id => [id, el(id)]));
  const doc: FocusableDocument = {getElementById: id => (els.get(id) as never) ?? null};
  return {doc, focused};
}

describe('controlProps', () => {
  it('points aria-describedby at the error Field renders, else its hint', () => {
    expect(controlProps('as-app-name', 'Enter a name', true)).toEqual({
      id: 'as-app-name',
      'aria-invalid': true,
      'aria-describedby': 'as-app-name-error',
    });
    expect(controlProps('as-app-name', undefined, true)['aria-describedby']).toBe('as-app-name-hint');
    expect(controlProps('as-terms', undefined)).toEqual({id: 'as-terms', 'aria-invalid': undefined, 'aria-describedby': undefined});
    expect(comboboxControl(controlProps('as-timezone', 'Pick one'))).toEqual({
      id: 'as-timezone',
      invalid: true,
      describedBy: 'as-timezone-error',
    });
  });

  it('the described-by id exists in the Field markup (empty App name)', () => {
    const props = controlProps('as-app-name', 'Enter the app name.', true);
    const html = renderToStaticMarkup(
      createElement(Field, {id: 'as-app-name', label: 'App name', hint: 'Shown in the sidebar.', error: 'Enter the app name.', children: createElement('input', props)})
    );
    expect(html).toContain('aria-describedby="as-app-name-error"');
    expect(html).toContain('id="as-app-name-error"');
    expect(html).toContain('aria-invalid="true"');
  });
});

describe('focusFirstInvalid', () => {
  const ids = {appName: 'as-app-name', timezone: 'as-timezone', dateFormat: 'as-date-format'};

  it('focuses the first wrong field in page order, not schema or error order', () => {
    const {doc, focused} = fakeDoc(['as-app-name', 'as-timezone', 'as-date-format']);
    expect(focusFirstInvalid(ids, {dateFormat: 'Pick one', appName: 'Enter a name'}, doc)).toBe('as-app-name');
    expect(focused).toEqual(['as-app-name']);
  });

  it('skips fields without an error or a registered control, and does nothing when none match', () => {
    const {doc, focused} = fakeDoc(['as-app-name', 'as-timezone']);
    expect(focusFirstInvalid(ids, {appName: undefined, timezone: 'Pick a zone', logoUrl: 'Bad file'}, doc)).toBe('as-timezone');
    expect(focusFirstInvalid(ids, {logoUrl: 'Bad file'}, doc)).toBeNull();
    expect(focused).toEqual(['as-timezone']);
  });

  it('is a no-op without a document (server render)', () => {
    expect(focusFirstInvalid(ids, {appName: 'x'}, undefined)).toBeNull();
  });
});

describe('every useFormErrors screen wires its controls', () => {
  const files = [
    'src/portal/intelform/settings/general.tsx',
    'src/portal/intelform/settings/site.tsx',
    'src/portal/intelform/settings/data.tsx',
    'src/portal/intelform/settings/delivery.tsx',
    'src/portal/intelform/forms/dialogs.tsx',
    'src/portal/screens/templates.tsx',
  ];
  it.each(files)('%s uses errors.control for each errored Field', file => {
    const src = readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
    // Hand-written aria-invalid from errors.fields means no describedby and no focus target.
    expect(src).not.toMatch(/aria-invalid=\{[^}]*errors\.fields/);
    expect(src).not.toMatch(/invalid=\{Boolean\(errors\.fields/);
    const errored = [...src.matchAll(/error=\{errors\.fields\.(\w+)\}/g)].map(m => m[1]!);
    // ImageUpload (a button group, no single control) shows its own error in place.
    const ImageUploadFields = [...src.matchAll(/<ImageUpload\b[^\n]*error=\{errors\.fields\.(\w+)\}/g)].map(m => m[1]!);
    for (const name of errored.filter(n => !ImageUploadFields.includes(n))) {
      expect(src, `${file}: ${name}`).toMatch(new RegExp(`errors\\.control\\('${name}'`));
    }
  });
});
