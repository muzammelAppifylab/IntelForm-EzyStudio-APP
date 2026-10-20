import { describe, expect, it } from 'vitest'
import { blankDefinition, newField } from '@shared/form/definition'
import { docToText, filterSources, pipeSources, textToDoc } from './pipe-doc'

describe('pipe text ↔ editor document', () => {
  it('round-trips text with tokens, parts and fallbacks', () => {
    for (const text of ['Hi {f_abcd1234.first|there}!', '{f_abcd1234} and {f_wxyz9876}', 'Plain', '', 'Line one\nLine {f_abcd1234}']) {
      expect(docToText(textToDoc(text, true))).toBe(text)
    }
  })

  it('single-line mode folds newlines into spaces', () => {
    expect(docToText(textToDoc('a\nb', false))).toBe('a b')
  })

  it('makes chip nodes for tokens', () => {
    const doc = textToDoc('Hi {f_abcd1234.first|there}', false)
    expect(doc.content?.[0].content?.[1]).toEqual({ type: 'pipe', attrs: { id: 'f_abcd1234', part: 'first', fallback: 'there' } })
  })

  it('lists earlier storing fields and their parts', () => {
    const def = {
      ...blankDefinition(),
      fields: [
        newField('name', { id: 'f_name0001', label: 'Your name', props: { split: true } }),
        newField('section_break', { id: 'f_sect0001', label: 'Next' }),
        newField('email', { id: 'f_mail0001', label: 'Email' }),
      ],
    }
    const before = pipeSources(def, 2)
    expect(before.map((s) => s.label)).toEqual(['Your name', 'Your name: first name', 'Your name: last name'])
    expect(filterSources(pipeSources(def), 'mail').map((s) => s.fieldId)).toEqual(['f_mail0001'])
  })
})
