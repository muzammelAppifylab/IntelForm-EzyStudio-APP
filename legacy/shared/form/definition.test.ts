import { describe, expect, it } from 'vitest'
import { csvHeaders, answerToCsv, csvRowFor } from './csv'
import {
  OTHER_OPTION_ID,
  blankDefinition,
  fieldsByPage,
  formDefinition,
  newField,
  newFieldId,
  newOptionId,
  fieldId,
  optionId,
  type FormField,
} from './definition'
import { SYSTEM_LABELS, errorMessage, formatLabel } from './labels'
import { isSafeUrl, safeUrl } from './safe-url'

describe('formDefinition', () => {
  it('accepts a blank form', () => {
    expect(formDefinition.safeParse(blankDefinition()).success).toBe(true)
  })

  it('accepts the PRD example definition and fills prop defaults', () => {
    const example = {
      layout: 'one_at_a_time',
      startScreen: { enabled: true, title: 'Quick survey', button: 'Start', minutes: 2 },
      fields: [
        { id: 'f_8k2m', type: 'name', label: 'Your name', required: true, props: { split: true } },
        {
          id: 'f_q71x',
          type: 'single_choice',
          label: 'Hi {f_8k2m.first}, how did you find us?',
          props: { options: [{ id: 'o_a1', label: 'Search' }, { id: 'o_b2', label: 'Friend' }], other: true },
          logic: { action: 'show', match: 'all', conditions: [{ field: 'f_8k2m', op: 'is_not_empty' }] },
        },
      ],
      endScreen: { title: 'Thanks!', message: 'We got it.', redirectUrl: null },
    }
    const parsed = formDefinition.parse(example)
    const choice = parsed.fields[1]
    expect(choice.type === 'single_choice' && choice.props).toEqual({
      options: [{ id: 'o_a1', label: 'Search' }, { id: 'o_b2', label: 'Friend' }],
      other: true,
      randomize: false,
      orientation: 'vertical',
    })
  })

  it('rejects unknown field types and malformed ids', () => {
    const bad = { ...blankDefinition(), fields: [{ id: 'name', type: 'payment', label: 'x' }] }
    expect(formDefinition.safeParse(bad).success).toBe(false)
    const unknownType = { ...blankDefinition(), fields: [{ id: 'f_abcd', type: 'payment', label: 'x' }] }
    expect(formDefinition.safeParse(unknownType).success).toBe(false)
  })

  it('rejects duplicate field ids, duplicate option ids and the reserved Other id', () => {
    const dupFields = { ...blankDefinition(), fields: [newField('email', { id: 'f_abcd' }), newField('email', { id: 'f_abcd' })] }
    expect(formDefinition.safeParse(dupFields).success).toBe(false)
    const dupOpts = { ...blankDefinition(), fields: [{ id: 'f_abcd', type: 'dropdown', props: { options: [{ id: 'o_aa', label: 'A' }, { id: 'o_aa', label: 'B' }] } }] }
    expect(formDefinition.safeParse(dupOpts).success).toBe(false)
    const reserved = { ...blankDefinition(), fields: [{ id: 'f_abcd', type: 'dropdown', props: { options: [{ id: OTHER_OPTION_ID, label: 'A' }] } }] }
    expect(formDefinition.safeParse(reserved).success).toBe(false)
  })

  it('validates props per type', () => {
    const bad = { ...blankDefinition(), fields: [{ id: 'f_abcd', type: 'rating', props: { scale: 20 } }] }
    expect(formDefinition.safeParse(bad).success).toBe(false)
  })

  it('accepts only http(s) URLs everywhere', () => {
    const withUrls = (url: string) => ({
      ...blankDefinition(),
      startScreen: { enabled: true, title: 'x', imageUrl: url, imageAlt: 'A photo' },
      endScreen: { title: 't', button: { label: 'Home', url } },
    })
    expect(formDefinition.safeParse(withUrls('https://example.com/a.png')).success).toBe(true)
    expect(formDefinition.safeParse(withUrls('javascript:alert(1)')).success).toBe(false)
    const picture = { ...blankDefinition(), fields: [{ id: 'f_abcd', type: 'picture_choice', props: { options: [{ id: 'o_aa', label: 'A', imageUrl: 'data:image/png;base64,AAA' }] } }] }
    expect(formDefinition.safeParse(picture).success).toBe(false)
    const consent = { ...blankDefinition(), fields: [{ id: 'f_abcd', type: 'consent', props: { link: { label: 'Terms', url: 'ftp://x.com' } } }] }
    expect(formDefinition.safeParse(consent).success).toBe(false)
  })

  it('every new field of every type parses', () => {
    const types = ['email', 'name', 'phone', 'address', 'country', 'short_text', 'long_text', 'number', 'url', 'date', 'time', 'single_choice', 'multiple_choice', 'dropdown', 'yes_no', 'picture_choice', 'rating', 'nps', 'signature', 'consent', 'section_break'] as const
    const d = { ...blankDefinition(), fields: types.map((t) => newField(t)) }
    const r = formDefinition.safeParse(d)
    expect(r.success).toBe(true)
    expect(r.data).toEqual(d)
  })
})

describe('ids', () => {
  it('generates valid, distinct ids', () => {
    const f = new Set(Array.from({ length: 2000 }, newFieldId))
    const o = new Set(Array.from({ length: 2000 }, newOptionId))
    expect(f.size).toBe(2000)
    expect(o.size).toBe(2000)
    for (const id of f) expect(fieldId.safeParse(id).success).toBe(true)
    for (const id of o) {
      expect(optionId.safeParse(id).success).toBe(true)
      expect(id).not.toBe(OTHER_OPTION_ID)
    }
  })
})

describe('fieldsByPage', () => {
  it('splits at section breaks', () => {
    const fields: FormField[] = [
      newField('email', { id: 'f_aaaa' }),
      newField('section_break', { id: 'f_sec1', label: 'Two' }),
      newField('yes_no', { id: 'f_bbbb' }),
      newField('section_break', { id: 'f_sec2' }),
    ]
    const pages = fieldsByPage({ fields })
    expect(pages.map((p) => [p.section?.id ?? null, p.fields.map((f) => f.id)])).toEqual([
      [null, ['f_aaaa']],
      ['f_sec1', ['f_bbbb']],
      ['f_sec2', []],
    ])
    expect(fieldsByPage({ fields: fields.slice(1) })[0].section?.id).toBe('f_sec1')
  })
})

describe('csv', () => {
  it('builds headers and cells per type', () => {
    const name = newField('name', { id: 'f_name', label: 'Your name', props: { split: true } })
    const addr = newField('address', { id: 'f_addr', label: 'Address', props: { lines: { street: true, line2: false, city: true, state: false, postal: false, country: true } } })
    const multi = newField('multiple_choice', { id: 'f_mult', label: 'Pick', props: { options: [{ id: 'o_a1', label: 'Search' }, { id: 'o_b2', label: 'Friend' }], other: true, randomize: false, orientation: 'vertical', minSelections: null, maxSelections: null } })
    const sig = newField('signature', { id: 'f_sign', label: 'Sign' })
    const sec = newField('section_break', { id: 'f_sect' })
    expect(csvHeaders(name)).toEqual(['Your name (first name)', 'Your name (last name)'])
    expect(csvHeaders(addr)).toEqual(['Address (street)', 'Address (city)', 'Address (country)'])
    expect(csvHeaders(sec)).toEqual([])
    expect(answerToCsv(name, { first: 'Ada', last: 'Lovelace' })).toEqual(['Ada', 'Lovelace'])
    expect(answerToCsv(name, undefined)).toEqual(['', ''])
    expect(answerToCsv(addr, { street: '1 Main', city: 'Leeds', country: 'GB' })).toEqual(['1 Main', 'Leeds', 'GB'])
    expect(answerToCsv(multi, [{ option: 'o_a1' }, { option: 'o_other', other: 'Radio' }])).toEqual(['Search; Radio'])
    expect(answerToCsv(sig, { url: 'https://cdn.example.com/s.png' })).toEqual(['https://cdn.example.com/s.png'])
    expect(csvRowFor([name, sec, sig], { f_name: 'garbage' })).toEqual(['garbage', '', ''])
  })
})

describe('labels', () => {
  it('formats placeholders and error codes', () => {
    expect(formatLabel(SYSTEM_LABELS.step, { n: 2, total: 4 })).toBe('Step 2 of 4')
    expect(formatLabel(SYSTEM_LABELS.question, { n: 3, total: 8 })).toBe('Question 3 of 8')
    expect(errorMessage('minChars:5')).toBe('Enter at least 5 characters')
    expect(errorMessage('nonsense')).toBe(SYSTEM_LABELS.invalid)
  })
})

describe('safeUrl', () => {
  it.each([
    ['https://example.com', true],
    ['http://example.com/x?y=1', true],
    ['  https://example.com  ', true],
    ['javascript:alert(1)', false],
    ['data:text/html,hi', false],
    ['//example.com', false],
    ['/relative', false],
    ['ftp://example.com', false],
  ])('%s → %s', (url, ok) => {
    expect(safeUrl.safeParse(url).success).toBe(ok)
  })

  it('isSafeUrl rejects overlong URLs', () => {
    expect(isSafeUrl(`https://example.com/${'a'.repeat(2100)}`)).toBe(false)
  })
})
