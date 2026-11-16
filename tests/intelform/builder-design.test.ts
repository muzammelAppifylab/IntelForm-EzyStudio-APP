import {describe, expect, it} from 'vitest';

import {defaultTheme, THEME_PRESETS} from '../../src/lib/intelform/form/theme-core';
import {formTheme} from '../../src/lib/intelform/form/theme';
import {applyPreset, COLOR_FIELDS, hexInput, isHex6, swatchVars} from '../../src/portal/intelform/builder/design/theme-edit';

describe('applyPreset', () => {
  const logo = {url: 'https://cdn.example.com/logo.png', position: 'center' as const, alt: 'Acme'};
  it('takes every preset option but keeps the logo', () => {
    const dark = THEME_PRESETS.find(p => p.mode === 'dark')!;
    const next = applyPreset({...defaultTheme(), logo}, dark);
    expect(next.colors).toEqual(dark.theme.colors);
    expect(next.font).toBe(dark.theme.font);
    expect(next.preset).toBe(dark.id);
    expect(next.logo).toEqual(logo);
    expect(formTheme.safeParse(next).success).toBe(true);
  });
  it('does not share objects with the preset', () => {
    const p = THEME_PRESETS[0]!;
    const next = applyPreset(defaultTheme(), p);
    next.colors.background = '#000000';
    expect(p.theme.colors.background).not.toBe('#000000');
    expect(next.logo).toBeNull();
  });
});

describe('hex input', () => {
  it('adds the # and validates #RRGGBB', () => {
    expect(hexInput('abcdef')).toBe('#abcdef');
    expect(hexInput(' #ABC ')).toBe('#ABC');
    expect(isHex6('#a1b2c3')).toBe(true);
    expect(isHex6('#abc')).toBe(false);
  });
});

describe('swatchVars', () => {
  it('paints a preset with its own colours, question font and corners', () => {
    const t = THEME_PRESETS[0]!.theme;
    const vars = swatchVars({...t, buttonRadius: 'pill'});
    expect(vars['--sw-bg']).toBe(t.colors.background);
    expect(vars['--sw-button']).toBe(t.colors.button);
    expect(vars['--sw-radius']).toBe('999px');
    expect(vars['--sw-font']).toContain(t.questionFont ?? t.font);
  });
  it('lists every colour once', () => {
    expect(new Set(COLOR_FIELDS.map(c => c.key)).size).toBe(5);
  });
});
