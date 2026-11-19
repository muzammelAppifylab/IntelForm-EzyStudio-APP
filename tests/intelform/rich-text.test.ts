import { describe, expect, it } from 'vitest'
import fc from 'fast-check'

import { answerToCsv } from '../../src/lib/intelform/form/csv'
import { blankDefinition, changeFieldType, formDefinition, newField, sanitizeDefinition } from '../../src/lib/intelform/form/definition'
import { interpolate, interpolateHtml, validateField, validateSubmission } from '../../src/lib/intelform/form/logic'
import { SYSTEM_LABELS } from '../../src/lib/intelform/form/labels'
import {
  answerPlainText,
  descriptionToHtml,
  htmlToPlain,
  isBlankHtml,
  plainToHtml,
  safeLinkHref,
  sanitizeRichText,
} from '../../src/lib/intelform/form/rich-text'
import { coreRegistry } from '../../src/lib/intelform/form/types/registry'
import { buildSearchText } from '../../src/server/intelform/respondent/answers'
import { displayAnswer } from '../../src/server/intelform/responses/format'

describe('sanitizeRichText', () => {
  it('keeps the formatting subset in its canonical spelling', () => {
    expect(sanitizeRichText('<p>Hi <b>bold</b> <i>it</i> <u>u</u> <strike>s</strike><br/>x</p><ul><li>a</li></ul><ol><li>b</li></ol>')).toBe(
      '<p>Hi <strong>bold</strong> <em>it</em> <u>u</u> <s>s</s><br>x</p><ul><li>a</li></ul><ol><li>b</li></ol>',
    )
  })

  it('drops scripts, handlers, styles, images and unknown tags', () => {
    const out = sanitizeRichText(
      '<p onclick="x()" style="color:red" class="c">a<script>alert(1)</script><img src=x onerror=alert(1)><iframe src="https://evil"></iframe><div>b</div><span style="x">c</span></p><style>p{}</style><!-- note -->',
    )
    expect(out).toBe('<p>a b c</p>')
    expect(out).not.toMatch(/script|onerror|onclick|style|img|iframe|<!--/)
  })

  it('keeps safe links only, opening in a new tab with rel', () => {
    expect(sanitizeRichText('<a href="https://example.com/a?b=1&amp;c=2" target="_self" onclick="x">x</a>')).toBe(
      '<p><a target="_blank" rel="noopener noreferrer nofollow ugc" href="https://example.com/a?b=1&amp;c=2">x</a></p>',
    )
    for (const bad of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'java&#09;script:alert(1)', 'data:text/html,x', 'vbscript:x']) {
      expect(sanitizeRichText(`<a href="${bad}">x</a>`)).not.toMatch(/href/)
    }
    expect(sanitizeRichText('<a href="mailto:a@b.co">m</a>')).toContain('href="mailto:a@b.co"')
  })

  it('inline mode keeps marks and links but no blocks, with words kept apart', () => {
    expect(sanitizeRichText('<p>one</p><p><b>two</b></p><ul><li>three</li></ul>a<br>b', { inline: true })).toBe(
      'one <strong>two</strong> three a b',
    )
  })

  it('is idempotent and never lets markup through text', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), (s) => {
        const once = sanitizeRichText(s)
        expect(sanitizeRichText(once)).toBe(once)
        expect(once).not.toMatch(/<(?!\/?(p|br|strong|em|u|s|ul|ol|li|a)[ >])/i)
        expect(once).not.toMatch(/\son[a-z]+=/i)
      }),
      { numRuns: 300 },
    )
    fc.assert(
      fc.property(fc.array(fc.constantFrom('<p>', '</p>', '<b>', '<a href="javascript:x">', '<script>', '"', "'", '<img src=x onerror=y>', 'text', '&lt;', '<', '>'), { maxLength: 30 }), (parts) => {
        const once = sanitizeRichText(parts.join(''))
        expect(sanitizeRichText(once)).toBe(once)
        expect(once).not.toMatch(/javascript|onerror|<script|<img/i)
      }),
      { numRuns: 300 },
    )
  })
})

describe('plain text ↔ rich text', () => {
  it('plainToHtml escapes and keeps lines as paragraphs', () => {
    expect(plainToHtml('a < b & c\n\nnext')).toBe('<p>a &lt; b &amp; c</p><p><br></p><p>next</p>')
    expect(plainToHtml('one\ntwo', true)).toBe('one two')
  })

  it('htmlToPlain gives readable text for CSV, emails and logic', () => {
    expect(htmlToPlain('<p>Hello <strong>you</strong> &amp; me</p><p>Line<br>break</p><ul><li>a</li><li>b</li></ul><ol><li>x</li><li>y</li></ol>')).toBe(
      'Hello you & me\nLine\nbreak\n• a\n• b\n1. x\n2. y',
    )
    expect(htmlToPlain('<a href="https://x.co">site</a>')).toBe('site')
  })

  it('isBlankHtml is true for empty paragraphs and spaces only', () => {
    expect(isBlankHtml('<p><br></p><p>&nbsp;</p>')).toBe(true)
    expect(isBlankHtml('<p>x</p>')).toBe(false)
    expect(isBlankHtml('')).toBe(true)
  })

  it('reads old plain descriptions and new rich ones', () => {
    expect(descriptionToHtml('Line 1\nLine <2>', undefined)).toBe('<p>Line 1</p><p>Line &lt;2&gt;</p>')
    expect(descriptionToHtml('<p><em>x</em></p>', 'html')).toBe('<p><em>x</em></p>')
    expect(descriptionToHtml(undefined, 'html')).toBe('')
  })

  it('safeLinkHref adds https and refuses other schemes', () => {
    expect(safeLinkHref('example.com')).toBe('https://example.com/')
    expect(safeLinkHref('ada@example.com')).toBe('mailto:ada@example.com')
    expect(safeLinkHref('javascript:alert(1)')).toBeNull()
    expect(safeLinkHref('not a link')).toBeNull()
  })
})

describe('rich text descriptions', () => {
  it('the schema accepts a rich description and its format, and change of type keeps both', () => {
    const f = { ...newField('short_text', { label: 'Q' }), description: '<p><strong>Hi</strong></p>', descriptionFormat: 'html' as const }
    const def = { ...blankDefinition(), fields: [f] }
    expect(formDefinition.safeParse(def).success).toBe(true)
    const changed = changeFieldType(f, 'long_text')
    expect(changed.description).toBe('<p><strong>Hi</strong></p>')
    expect(changed.descriptionFormat).toBe('html')
  })

  it('sanitizeDefinition cleans stored rich descriptions and leaves plain ones', () => {
    const rich = { ...newField('email'), description: '<p>a<script>x</script><img src=x></p>', descriptionFormat: 'html' as const }
    const plain = { ...newField('email'), description: '<b>stays as typed</b>' }
    const out = sanitizeDefinition({ ...blankDefinition(), fields: [rich, plain] })
    expect(out.fields[0].description).toBe('<p>a</p>')
    expect(out.fields[1].description).toBe('<b>stays as typed</b>')
  })

  it('interpolateHtml escapes piped answers; interpolate stays plain', () => {
    const name = newField('short_text', { id: 'f_name1234', label: 'Name' })
    const def = { ...blankDefinition(), fields: [name] }
    const answers = { f_name1234: '<img src=x onerror=alert(1)>' }
    const html = interpolateHtml('<p>Hi <strong>{f_name1234|there}</strong></p>', def, answers)
    expect(html).toBe('<p>Hi <strong>&lt;img src=x onerror=alert(1)&gt;</strong></p>')
    expect(sanitizeRichText(html)).not.toContain('<img')
    expect(interpolateHtml('<p>Hi {f_name1234|you &amp; me}</p>', def, {})).toBe('<p>Hi you &amp; me</p>')
    expect(interpolate('Hi {f_name1234}', def, answers)).toBe('Hi <img src=x onerror=alert(1)>')
  })
})

describe('rich text answers', () => {
  const long = newField('long_text', { id: 'f_long1234', label: 'Story', props: { richText: true, minLength: 3, maxLength: 20 } })
  const short = newField('short_text', { id: 'f_shrt1234', label: 'Title', props: { richText: true } })

  it('richText is off by default and carries over between short and long text', () => {
    expect(newField('long_text').props.richText).toBe(false)
    expect(changeFieldType(long, 'short_text').props.richText).toBe(true)
  })

  it('stores sanitized {html}; limits count the visible text, not the markup', () => {
    const ok = validateField(long, { html: '<p><b>Hello</b> <span onclick="x">there</span></p>' }, SYSTEM_LABELS)
    expect(ok).toEqual({ ok: true, value: { html: '<p><strong>Hello</strong> there</p>' }, empty: false })
    const markupHeavy = `<p>${'<strong></strong>'.repeat(50)}abcdefghij</p>`
    expect(validateField(long, { html: markupHeavy }, SYSTEM_LABELS).ok).toBe(true)
    const tooLong = validateField(long, { html: '<p>abcdefghijklmnopqrstuvwxyz</p>' }, SYSTEM_LABELS)
    expect(tooLong.ok).toBe(false)
    const tooShort = validateField(long, { html: '<p><strong>ab</strong></p>' }, SYSTEM_LABELS)
    expect(tooShort.ok).toBe(false)
  })

  it('a rich answer with no text is empty: required applies, and nothing is stored', () => {
    const required = { ...long, required: true }
    expect(validateField(required, { html: '<p><br></p>' }, SYSTEM_LABELS)).toMatchObject({ ok: false })
    expect(validateField(long, { html: '<p> </p>' }, SYSTEM_LABELS)).toEqual({ ok: true, value: undefined, empty: true })
  })

  it('accepts plain text from an older page as paragraphs', () => {
    expect(validateField(long, 'abc\ndef', SYSTEM_LABELS)).toMatchObject({ ok: true, value: { html: '<p>abc</p><p>def</p>' } })
  })

  it('a single-line answer keeps no blocks', () => {
    expect(validateField(short, { html: '<p>a</p><ul><li><em>b</em></li></ul>' }, SYSTEM_LABELS)).toMatchObject({
      ok: true,
      value: { html: 'a <em>b</em>' },
    })
  })

  it('a field without rich text refuses an {html} answer', () => {
    const plain = newField('long_text', { props: { richText: false } })
    expect(validateField(plain, { html: '<p>x</p>' }, SYSTEM_LABELS).ok).toBe(false)
  })

  it('CSV, piping, logic and search see the plain text, even after the setting is turned off', () => {
    const value = { html: '<p>Hello <strong>world</strong></p><ul><li>one</li></ul>' }
    expect(answerToCsv(long, value)).toEqual(['Hello world\n• one'])
    const off = { ...long, props: { ...long.props, richText: false } }
    expect(answerToCsv(off, value)).toEqual(['Hello world\n• one'])
    expect(coreRegistry.long_text.pipe(value, undefined, long)).toBe('Hello world\n• one')
    expect(coreRegistry.long_text.evaluate('contains', value, 'WORLD', long)).toBe(true)
    expect(answerPlainText('plain')).toBe('plain')
    expect(buildSearchText([long], { f_long1234: value })).toBe('Hello world\n• one')
  })

  it('the response drawer gets the plain text and the sanitized HTML', () => {
    expect(displayAnswer(long, { html: '<p>Hi <b>there</b><script>x</script></p>' })).toEqual({
      text: 'Hi there',
      html: '<p>Hi <strong>there</strong></p>',
    })
    expect(displayAnswer(long, 'plain answer')).toEqual({ text: 'plain answer' })
  })

  it('validateSubmission stores the canonical HTML', () => {
    const def = { ...blankDefinition(), fields: [long] }
    const r = validateSubmission(def, { f_long1234: { html: '<div>Some <i>text</i></div>' } })
    expect(r).toEqual({ ok: true, answers: { f_long1234: { html: '<p>Some <em>text</em></p>' } } })
  })
})
