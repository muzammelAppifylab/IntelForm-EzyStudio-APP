import { describe, expect, it } from 'vitest'
import { blankDefinition, newField } from '../../src/lib/intelform/form/definition'
import { filterSources, pipeSources, textToDoc } from '../../src/portal/intelform/builder/pipe/pipe-doc'

describe('pipe text ↔ editor document', () => {
  // The editor turns its DOM back into text itself (serialize in PipeEditor.tsx); this checks the
  // document it is given: one paragraph per line, text and chip nodes in order.
  it('splits lines into paragraphs of text and chip nodes', () => {
    expect(textToDoc('Hi {f_abcd1234.first|there}!\nLine two', true)).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Hi ' },
            { type: 'pipe', attrs: { id: 'f_abcd1234', part: 'first', fallback: 'there' } },
            { type: 'text', text: '!' },
          ],
        },
        { type: 'paragraph', content: [{ type: 'text', text: 'Line two' }] },
      ],
    })
    expect(textToDoc('', true)).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] })
  })

  it('single-line mode folds newlines into spaces', () => {
    expect(textToDoc('a\nb', false)).toEqual({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a b' }] }] })
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
