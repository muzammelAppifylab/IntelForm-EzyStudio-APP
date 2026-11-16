import {createElement, type ComponentType} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it} from 'vitest';

import {CONDITION_VALUE_INPUTS, FIELD_SETTINGS} from '../../src/form-types/settings';
import {FIELD_TYPES} from '../../src/lib/intelform/form/field-types';
import type {ConditionValueProps, FieldSettingsProps} from '../../src/portal/intelform/builder/type-ui';
import {createField} from '../../src/portal/intelform/builder/ops';
import {ToastProvider} from '../../src/portal/ui';

/** Builder settings panels and logic value inputs, rendered to markup (kit only, no Tailwind). */
describe('form-types builder UI (server markup)', () => {
  it('renders every settings panel with the kit, no inline style, read-only respected', () => {
    for (const t of FIELD_TYPES) {
      const Settings = FIELD_SETTINGS[t] as ComponentType<FieldSettingsProps>;
      const html = renderToStaticMarkup(
        createElement(ToastProvider, null, createElement(Settings, {field: createField(t), onChange: () => {}, readOnly: true}))
      );
      expect(html, t).not.toMatch(/style="/);
      // No Tailwind utility leftovers.
      expect(html, t).not.toMatch(/class="[^"]*\b(text-muted-foreground|grid-cols-2|gap-3|text-caption)\b/);
      expect(html.length, t).toBeGreaterThan(0);
    }
  });

  it('renders every logic value input with its accessible name', () => {
    for (const [t, Input] of Object.entries(CONDITION_VALUE_INPUTS)) {
      const C = Input as ComponentType<ConditionValueProps>;
      const html = renderToStaticMarkup(
        createElement(C, {field: createField(t as never), op: 'is', value: undefined, onChange: () => {}, label: 'Value for condition 1'})
      );
      expect(html, t).toContain('Value for condition 1');
    }
  });

  it('flags a phone "is" value that is not a full international number', () => {
    const C = CONDITION_VALUE_INPUTS.phone as ComponentType<ConditionValueProps>;
    const props = {field: createField('phone'), op: 'is' as const, onChange: () => {}, label: 'v'};
    expect(renderToStaticMarkup(createElement(C, {...props, value: '650'}))).toContain('aria-invalid="true"');
    expect(renderToStaticMarkup(createElement(C, {...props, value: '+16502530000'}))).not.toContain('aria-invalid');
  });
});
