import {readFileSync} from 'node:fs';

import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it} from 'vitest';

import {Icon, Popover} from '../../src/portal/ui';

/** F-040: an icon-only Popover trigger (Contacts "Show or hide columns") must have a name (axe button-name). */
describe('Popover trigger accessible name', () => {
  const render = (trigger?: Parameters<typeof Popover>[0]['trigger']) =>
    // oxlint-disable-next-line react/no-children-prop -- createElement from a .ts test; children is a required prop
    renderToStaticMarkup(createElement(Popover, {label: 'Show or hide columns', trigger, children: null}));
  const triggerTag = (html: string) => /<button[^>]*>/.exec(html)![0];

  it('names an icon-only trigger with its label', () => {
    expect(triggerTag(render(createElement(Icon, {name: 'columns', size: 18})))).toContain('aria-label="Show or hide columns"');
  });

  it('names the default trigger with its label', () => {
    expect(triggerTag(render())).toContain('aria-label="Show or hide columns"');
  });

  it('lets visible text name a text trigger (label in name)', () => {
    const html = render(createElement('span', null, 'Filter'));
    expect(triggerTag(html)).not.toContain('aria-label');
    expect(html).toContain('Filter');
  });

  it('the Contacts columns toggle is an icon-only Popover trigger', () => {
    const src = readFileSync('src/portal/screens/contacts.tsx', 'utf8');
    expect(src).toMatch(/<Popover label="Show or hide columns"[^\n]*trigger=\{<Icon name="columns"[^\n]*\/>\}>/);
  });
});

/** F-041: the "+N more" chip's text reaches WCAG AA (4.5:1) on its own fill, light and dark. */
describe('Contacts "+N more" chip contrast', () => {
  const base = readFileSync('src/styles/base.css', 'utf8');
  const contacts = readFileSync('src/styles/intelform/contacts.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

  function tokens(selector: string): Record<string, string> {
    const at = base.indexOf(selector);
    expect(at).toBeGreaterThanOrEqual(0);
    const body = base.slice(base.indexOf('{', at) + 1, base.indexOf('}', at));
    return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)].map(m => [m[1], m[2]]));
  }
  function rule(selector: string): Record<string, string> {
    const at = contacts.indexOf(`${selector} {`);
    expect(at).toBeGreaterThanOrEqual(0);
    const body = contacts.slice(contacts.indexOf('{', at) + 1, contacts.indexOf('}', at));
    return Object.fromEntries([...body.matchAll(/([\w-]+):\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]));
  }
  const lum = (hex: string) => {
    const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const contrast = (a: string, b: string) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };
  const resolve = (value: string, t: Record<string, string>) => {
    const m = /^var\((--[\w-]+)\)$/.exec(value);
    expect(m, `expected a token, got ${value}`).not.toBeNull();
    expect(t[m![1]], `${m![1]} is defined`).toBeDefined();
    return t[m![1]];
  };

  const light = tokens(':root {');
  const themes = {light, dark: {...light, ...tokens(":root[data-theme='dark'] {")}, 'dark (system)': {...light, ...tokens(":root:not([data-theme='light']) {")}};
  const chip = rule('.screen-contacts .contacts-chip-more');

  it.each(Object.entries(themes))('%s: at least 4.5:1', (_, t) => {
    expect(contrast(resolve(chip.color, t), resolve(chip.background, t))).toBeGreaterThanOrEqual(4.5);
  });
});
