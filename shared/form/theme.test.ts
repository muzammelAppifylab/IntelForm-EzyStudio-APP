import { describe, expect, it } from 'vitest'
import {
  THEME_PRESETS,
  TINTS,
  contrastRatio,
  defaultTheme,
  formTheme,
  mixOklab,
  surfaceColor,
  themeContrastIssues,
  themeToVars,
} from './theme'

describe('presets', () => {
  it('has 8 presets, 4 light then 4 dark, unique ids, all valid', () => {
    expect(THEME_PRESETS).toHaveLength(8)
    expect(THEME_PRESETS.map((p) => p.mode)).toEqual(['light', 'light', 'light', 'light', 'dark', 'dark', 'dark', 'dark'])
    expect(new Set(THEME_PRESETS.map((p) => p.id)).size).toBe(8)
    for (const p of THEME_PRESETS) expect(formTheme.parse(p.theme)).toEqual(p.theme)
  })

  it('the first preset is the IntelForm design-system default', () => {
    expect(THEME_PRESETS[0].theme.colors).toEqual({
      background: '#F7F5FF',
      question: '#1A1825',
      answer: '#5B3FD9',
      button: '#5B3FD9',
      buttonText: '#FFFFFF',
    })
    expect(THEME_PRESETS[0].theme.font).toBe('Inter')
    expect(defaultTheme()).toEqual(THEME_PRESETS[0].theme)
    expect(formTheme.parse({})).toEqual({ ...defaultTheme(), questionFont: null })
  })

  it.each(THEME_PRESETS.map((p) => [p.id, p] as const))('%s passes WCAG AA', (_id, p) => {
    const c = p.theme.colors
    expect(contrastRatio(c.question, c.background)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(c.buttonText, c.button)).toBeGreaterThanOrEqual(4.5)
    expect(themeContrastIssues(p.theme)).toEqual([])
    // Derived tints keep their contrast too.
    const surface = surfaceColor(p.theme)
    expect(contrastRatio(c.question, surface)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(mixOklab(c.question, TINTS.mutedForeground, c.background), c.background)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(mixOklab(c.question, TINTS.placeholder, c.background), surface)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(mixOklab(c.question, TINTS.input, c.background), surface)).toBeGreaterThanOrEqual(3)
    expect(contrastRatio(c.question, mixOklab(c.answer, TINTS.optionSelected, surface))).toBeGreaterThanOrEqual(4.5)
  })
})

describe('contrast', () => {
  it('computes WCAG 2 ratios', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5)
    expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBe(1)
    expect(contrastRatio('#777777', '#FFFFFF')).toBeCloseTo(4.48, 2)
  })

  it('reports low-contrast settings with a fix-it message', () => {
    const t = defaultTheme()
    t.colors.question = '#BBBBBB'
    t.colors.buttonText = '#6A50E0'
    const issues = themeContrastIssues(t)
    expect(issues.map((i) => i.key)).toEqual(['question', 'buttonText'])
    expect(issues[0].message).toMatch(/needs 4.5:1/)
  })

  it('checks image backgrounds against the overlay', () => {
    const t = formTheme.parse({
      colors: { background: '#FFFFFF', question: '#FFFFFF', answer: '#FFFFFF', button: '#FFFFFF', buttonText: '#000000' },
      background: { type: 'image', imageUrl: 'https://cdn.example.com/bg.jpg', overlay: 80 },
    })
    expect(themeContrastIssues(t).map((i) => i.key)).toEqual([])
  })
})

describe('themeToVars', () => {
  it('normalises hex input', () => {
    expect(formTheme.parse({ colors: { background: '#fff', question: '#000', answer: '#5b3fd9', button: '#5B3FD9', buttonText: '#FFF' } }).colors.background).toBe('#FFFFFF')
  })

  it('matches the snapshot for the default and a dark image theme', () => {
    expect(themeToVars(defaultTheme())).toMatchSnapshot()
    const dark = formTheme.parse({
      ...THEME_PRESETS[4].theme,
      background: { type: 'image', imageUrl: 'https://cdn.example.com/bg.jpg', overlay: 50 },
      logo: { url: 'https://cdn.example.com/logo.svg', position: 'center' },
      buttonRadius: 'pill',
      fontSize: 'l',
    })
    expect(themeToVars(dark)).toMatchSnapshot()
  })

  it('covers every token the renderer reads', () => {
    const vars = themeToVars(defaultTheme())
    for (const k of [
      '--form-bg', '--form-surface', '--form-question', '--form-answer', '--form-button', '--form-button-foreground',
      '--form-progress', '--form-font', '--form-question-font', '--form-radius',
      '--background', '--foreground', '--card', '--primary', '--primary-foreground', '--ring',
      '--option-selected-border', '--option-selected', '--option-selected-foreground', '--option', '--option-border',
      '--field', '--input', '--field-placeholder', '--muted-foreground', '--radius',
    ]) {
      expect(vars[k], k).toBeTruthy()
    }
  })
})
