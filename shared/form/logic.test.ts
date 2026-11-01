import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { blankDefinition, formDefinition, newField, type FormDefinition, type FormField } from './definition'
import {
  PIPE_RE,
  computeVisibility,
  dependentsOf,
  emailDedupeKey,
  interpolate,
  lintLogic,
  lintOnePerEmail,
  orderViolations,
  parsePipes,
  pipeToken,
  pruneAnswers,
  validatePage,
  validateSubmission,
  type Answers,
} from './logic'

const choiceProps = { options: [{ id: 'o_a1', label: 'Search' }, { id: 'o_b2', label: 'Friend' }], other: true }

function def(fields: unknown[], extra: Partial<FormDefinition> = {}): FormDefinition {
  return formDefinition.parse({ ...blankDefinition(), ...extra, fields })
}

/** The PRD "Data model" example, verbatim. */
const PRD_EXAMPLE = {
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

describe('PRD example', () => {
  const d = formDefinition.parse(PRD_EXAMPLE)

  it('shows the follow-up only once a name is given', () => {
    expect(computeVisibility(d, {}).fields.has('f_q71x')).toBe(false)
    expect(computeVisibility(d, { f_8k2m: { first: 'Ada', last: '' } }).fields.has('f_q71x')).toBe(true)
  })

  it('pipes the first name with a fallback', () => {
    expect(interpolate(d.fields[1].label, d, { f_8k2m: { first: 'Ada', last: 'L' } })).toBe('Hi Ada, how did you find us?')
    expect(interpolate('Hi {f_8k2m.first|there}!', d, {})).toBe('Hi there!')
    expect(interpolate('Hi {f_8k2m.first}!', d, {})).toBe('Hi !')
  })

  it('validates a full submission', () => {
    const r = validateSubmission(d, { f_8k2m: { first: ' Ada ', last: 'Lovelace' }, f_q71x: { option: 'o_other', other: 'Podcast' } })
    expect(r).toEqual({
      ok: true,
      answers: { f_8k2m: { first: 'Ada', last: 'Lovelace' }, f_q71x: { option: 'o_other', other: 'Podcast' } },
    })
  })

  it('lints clean', () => {
    expect(lintLogic(d)).toEqual([])
  })
})

describe('visibility', () => {
  const d = def([
    { id: 'f_nps1', type: 'nps', label: 'Score' },
    { id: 'f_low1', type: 'long_text', label: 'What went wrong?', required: true, logic: { action: 'show', match: 'all', conditions: [{ field: 'f_nps1', op: 'lte', value: 6 }] } },
    { id: 'f_hig1', type: 'long_text', label: 'What did you love?', logic: { action: 'hide', match: 'any', conditions: [{ field: 'f_nps1', op: 'lt', value: 9 }, { field: 'f_nps1', op: 'is_empty' }] } },
    { id: 'f_sec1', type: 'section_break', label: 'Details', logic: { action: 'show', match: 'all', conditions: [{ field: 'f_nps1', op: 'gte', value: 7 }] } },
    { id: 'f_em01', type: 'email', label: 'Email', required: true },
    { id: 'f_sec2', type: 'section_break', label: 'More' },
    { id: 'f_yn01', type: 'yes_no', label: 'Again?' },
  ])

  it('show / hide with all and any', () => {
    const lo = computeVisibility(d, { f_nps1: 3 })
    expect(lo.fields.has('f_low1')).toBe(true)
    expect(lo.fields.has('f_hig1')).toBe(false)
    const hi = computeVisibility(d, { f_nps1: 10 })
    expect(hi.fields.has('f_low1')).toBe(false)
    expect(hi.fields.has('f_hig1')).toBe(true)
  })

  it('a section-break rule hides its whole page; empty pages are skipped', () => {
    const lo = computeVisibility(d, { f_nps1: 3 })
    expect(lo.fields.has('f_sec1')).toBe(false)
    expect(lo.fields.has('f_em01')).toBe(false)
    expect(lo.pages).toEqual([['f_nps1', 'f_low1'], ['f_yn01']])
    expect(lo.pageSections).toEqual([null, 'f_sec2'])
    const hi = computeVisibility(d, { f_nps1: 9 })
    expect(hi.pages).toEqual([['f_nps1', 'f_hig1'], ['f_em01'], ['f_yn01']])
  })

  it('a hidden source counts as empty', () => {
    const chain = def([
      { id: 'f_aaaa', type: 'yes_no', label: 'A' },
      { id: 'f_bbbb', type: 'short_text', label: 'B', logic: { action: 'show', match: 'all', conditions: [{ field: 'f_aaaa', op: 'is_yes' }] } },
      { id: 'f_cccc', type: 'short_text', label: 'C', logic: { action: 'show', match: 'all', conditions: [{ field: 'f_bbbb', op: 'is_not_empty' }] } },
    ])
    expect(computeVisibility(chain, { f_aaaa: true, f_bbbb: 'x' }).fields.has('f_cccc')).toBe(true)
    expect(computeVisibility(chain, { f_aaaa: false, f_bbbb: 'x' }).fields.has('f_cccc')).toBe(false)
  })

  it('required applies only while visible; hidden answers are rejected or dropped', () => {
    expect(validateSubmission(d, { f_nps1: 10 })).toEqual({ ok: false, errors: { f_em01: 'This question is required' } })
    expect(validateSubmission(d, { f_nps1: 3 })).toEqual({ ok: false, errors: { f_low1: 'This question is required' } })
    const hidden = { f_nps1: 10, f_em01: 'a@b.co', f_low1: 'sneaky' }
    expect(validateSubmission(d, hidden)).toEqual({ ok: false, errors: { f_low1: 'This question is not shown, so it cannot be answered' } })
    expect(validateSubmission(d, hidden, { hidden: 'drop' })).toEqual({ ok: true, answers: { f_nps1: 10, f_em01: 'a@b.co' } })
  })

  it('uses custom required errors, else the system labels', () => {
    const d2 = def([
      { id: 'f_req1', type: 'short_text', label: 'A', required: true, requiredError: 'We need this one' },
      { id: 'f_req2', type: 'email', label: 'B', required: true },
      { id: 'f_req3', type: 'short_text', label: 'C', props: { minLength: 5 } },
    ])
    expect(validateSubmission(d2, { f_req3: 'abc' })).toEqual({
      ok: false,
      errors: { f_req1: 'We need this one', f_req2: 'This question is required', f_req3: 'Enter at least 5 characters' },
    })
    expect(validatePage(d2, { f_req1: 'x' }, ['f_req1', 'f_req2'])).toEqual({ f_req2: 'This question is required' })
  })

  it('drops unknown keys and section breaks, rejects non-objects', () => {
    expect(validateSubmission(d, { f_nps1: 10, f_em01: 'a@b.co', f_zzzz: 1, f_sec2: 'x' })).toEqual({
      ok: true,
      answers: { f_nps1: 10, f_em01: 'a@b.co' },
    })
    expect(validateSubmission(d, [1]).ok).toBe(false)
  })
})

describe('lint and builder warnings', () => {
  const d = def([
    { id: 'f_aaaa', type: 'single_choice', label: 'Pick', props: choiceProps },
    { id: 'f_bbbb', type: 'short_text', label: 'Why {f_aaaa}? {f_cccc}', logic: { action: 'show', match: 'all', conditions: [
      { field: 'f_aaaa', op: 'is', value: 'o_gone' },
      { field: 'f_aaaa', op: 'contains', value: 'x' },
      { field: 'f_cccc', op: 'is_not_empty' },
      { field: 'f_bbbb', op: 'is_not_empty' },
      { field: 'f_dead', op: 'is_empty' },
      { field: 'f_aaaa', op: 'is' },
    ] } },
    { id: 'f_cccc', type: 'number', label: 'N', logic: { action: 'show', match: 'any', conditions: [
      { field: 'f_aaaa', op: 'is', value: 'o_other' },
      { field: 'f_sect', op: 'is_empty' },
    ] } },
    { id: 'f_sect', type: 'section_break', label: 'S' },
    { id: 'f_dddd', type: 'number', label: 'M', logic: { action: 'show', match: 'all', conditions: [{ field: 'f_cccc', op: 'gt', value: 'ten' }] } },
  ], { endScreen: { title: 'Thanks {f_aaaa}', message: '{f_gone}' } })

  it('reports every kind of broken reference', () => {
    const codes = lintLogic(d).map((i) => `${i.fieldId}:${i.code}`)
    expect(codes).toEqual([
      'f_bbbb:unknown_option',
      'f_bbbb:bad_operator',
      'f_bbbb:later_source',
      'f_bbbb:self_reference',
      'f_bbbb:missing_source',
      'f_bbbb:missing_value',
      'f_bbbb:pipe_later',
      'f_cccc:later_source',
      'f_dddd:bad_value',
      'endScreen:pipe_missing',
    ])
    expect(lintLogic(d).every((i) => i.message.length > 10)).toBe(true)
  })

  it('asks for the country code when a phone rule matches a whole number', () => {
    const rule = (op: string, value: string) => ({ action: 'show', match: 'all', conditions: [{ field: 'f_ph01', op, value }] })
    const phoneDef = def([
      { id: 'f_ph01', type: 'phone', label: 'Phone' },
      { id: 'f_ok01', type: 'short_text', label: 'A', logic: rule('is', '+1 (650) 253-0000') },
      { id: 'f_ok02', type: 'short_text', label: 'B', logic: rule('contains', '650') },
      { id: 'f_bad1', type: 'short_text', label: 'C', logic: rule('is', '07700 900123') },
      { id: 'f_bad2', type: 'short_text', label: 'D', logic: rule('is_not', '6502530000') },
    ])
    const issues = lintLogic(phoneDef)
    expect(issues.map((i) => `${i.fieldId}:${i.code}`)).toEqual(['f_bad1:bad_value', 'f_bad2:bad_value'])
    expect(issues[0].message).toContain('country code')
  })

  it('dependentsOf lists rules and pipes', () => {
    expect(dependentsOf(d, 'f_aaaa')).toEqual([
      { fieldId: 'f_bbbb', via: 'logic', conditionIndex: 0 },
      { fieldId: 'f_bbbb', via: 'logic', conditionIndex: 1 },
      { fieldId: 'f_bbbb', via: 'logic', conditionIndex: 5 },
      { fieldId: 'f_bbbb', via: 'pipe' },
      { fieldId: 'f_cccc', via: 'logic', conditionIndex: 0 },
      { fieldId: 'endScreen', via: 'pipe' },
    ])
  })

  it('orderViolations finds sources at or below their target', () => {
    expect(orderViolations(d)).toEqual([
      { target: 'f_bbbb', source: 'f_cccc' },
      { target: 'f_bbbb', source: 'f_bbbb' },
      { target: 'f_cccc', source: 'f_sect' },
    ])
  })
})

describe('piping', () => {
  const d = def([
    { id: 'f_name', type: 'name', label: 'Name', props: { split: true } },
    { id: 'f_addr', type: 'address', label: 'Address' },
    { id: 'f_pick', type: 'multiple_choice', label: 'Pick', props: choiceProps },
  ])
  const answers = {
    f_name: { first: 'Ada', last: 'Lovelace' },
    f_addr: { city: 'Leeds', country: 'GB' },
    f_pick: [{ option: 'o_a1' }, { option: 'o_other', other: 'Radio' }],
  }

  it('interpolates parts, defaults and fallbacks', () => {
    expect(interpolate('{f_name.first} {f_name.last}', d, answers)).toBe('Ada Lovelace')
    expect(interpolate('{f_name}', d, answers)).toBe('Ada Lovelace')
    expect(interpolate('From {f_addr.city|somewhere}', d, answers)).toBe('From Leeds')
    expect(interpolate('From {f_addr.state|somewhere}', d, answers)).toBe('From somewhere')
    expect(interpolate('You chose {f_pick}', d, answers)).toBe('You chose Search, Radio')
    expect(interpolate('Hi {f_name.first|friend}', d, {})).toBe('Hi friend')
    expect(interpolate('Hi {f_none|you}', d, answers)).toBe('Hi you')
    expect(interpolate('Fallback with spaces {f_name.first|dear reader}', d, {})).toBe('Fallback with spaces dear reader')
    expect(interpolate('No tokens {here}', d, answers)).toBe('No tokens {here}')
    expect(interpolate('', d, answers)).toBe('')
  })

  it('parses and builds tokens', () => {
    expect(parsePipes('a {f_name.first|there} b {f_addr}')).toEqual([
      { raw: '{f_name.first|there}', fieldId: 'f_name', part: 'first', fallback: 'there', index: 2 },
      { raw: '{f_addr}', fieldId: 'f_addr', index: 25 },
    ])
    expect(pipeToken('f_name', 'first', 'th{e}re')).toBe('{f_name.first|there}')
    expect('{f_addr.line2}'.match(PIPE_RE)).toEqual(['{f_addr.line2}'])
  })
})

// ---------------------------------------------------------------------------------------
// Properties over random forward-only definitions

const TYPES = ['short_text', 'number', 'yes_no', 'single_choice', 'multiple_choice', 'rating', 'section_break', 'email'] as const
type T = (typeof TYPES)[number]

const OPS: Record<Exclude<T, 'section_break'>, [string, unknown[]][]> = {
  short_text: [['is', ['a', 'b']], ['contains', ['a']], ['is_empty', [undefined]], ['is_not_empty', [undefined]]],
  email: [['contains', ['@x.co']], ['is_empty', [undefined]]],
  number: [['gt', [1, 5]], ['lte', [3]], ['eq', [2]], ['is_empty', [undefined]]],
  rating: [['gte', [3]], ['neq', [1]]],
  yes_no: [['is_yes', [undefined]], ['is_no', [undefined]]],
  single_choice: [['is', ['o_a1', 'o_b2', 'o_other']], ['is_not', ['o_a1']], ['is_empty', [undefined]]],
  multiple_choice: [['includes', ['o_a1', 'o_b2']], ['not_includes', ['o_a1']]],
}

const ANSWERS: Record<T, unknown[]> = {
  short_text: [undefined, '', '  ', 'a', 'b', 'abc', 5],
  email: [undefined, '', 'me@x.co', 'bad'],
  number: [undefined, '', 0, 1, 2, 3, 5, 10, '4', 'x'],
  rating: [undefined, 1, 3, 5, 9],
  yes_no: [undefined, true, false, 'yes'],
  single_choice: [undefined, { option: 'o_a1' }, { option: 'o_b2' }, { option: 'o_other', other: 'hi' }, { option: '' }, 'o_a1'],
  multiple_choice: [undefined, [], [{ option: 'o_a1' }], [{ option: 'o_a1' }, { option: 'o_b2' }], ['o_a1']],
  section_break: [undefined, 'x'],
}

const arbDefinition = fc
  .array(
    fc.record({
      type: fc.constantFrom(...TYPES),
      required: fc.boolean(),
      hasRule: fc.boolean(),
      action: fc.constantFrom('show', 'hide'),
      match: fc.constantFrom('all', 'any'),
      picks: fc.array(fc.tuple(fc.nat(), fc.nat(), fc.nat()), { minLength: 1, maxLength: 3 }),
    }),
    { minLength: 1, maxLength: 12 },
  )
  .map((specs) => {
    const fields: FormField[] = []
    specs.forEach((s, i) => {
      const id = `f_x${String(i).padStart(3, '0')}`
      const f = newField(s.type, {
        id,
        label: `Q${i}`,
        required: s.required,
        ...((s.type === 'single_choice' || s.type === 'multiple_choice') && { props: choiceProps }),
      } as never) as FormField
      const sources = fields.filter((x) => x.type !== 'section_break')
      if (s.hasRule && sources.length) {
        f.logic = {
          action: s.action,
          match: s.match,
          conditions: s.picks.map(([a, b, c]) => {
            const src = sources[a % sources.length]
            const ops = OPS[src.type as Exclude<T, 'section_break'>]
            const [op, values] = ops[b % ops.length]
            const value = values[c % values.length]
            return { field: src.id, op, ...(value !== undefined && { value }) } as never
          }),
        }
      }
      fields.push(f)
    })
    return formDefinition.parse({ ...blankDefinition(), fields })
  })

const arbCase = arbDefinition.chain((d) =>
  fc
    .tuple(...d.fields.map((f) => fc.option(fc.constantFrom(...ANSWERS[f.type as T]), { nil: undefined })))
    .map((vals) => {
      const answers: Answers = {}
      d.fields.forEach((f, i) => {
        if (vals[i] !== undefined) answers[f.id] = vals[i]
      })
      return { d, answers }
    }),
)

const sameVisibility = (a: ReturnType<typeof computeVisibility>, b: ReturnType<typeof computeVisibility>) => {
  expect([...a.fields].sort()).toEqual([...b.fields].sort())
  expect(a.pages).toEqual(b.pages)
}

describe('logic properties', () => {
  it('random definitions lint clean (forward-only by construction)', () => {
    fc.assert(fc.property(arbDefinition, (d) => lintLogic(d).length === 0))
  })

  it('prune is idempotent', () => {
    fc.assert(
      fc.property(arbCase, ({ d, answers }) => {
        const once = pruneAnswers(d, answers)
        expect(pruneAnswers(d, once)).toEqual(once)
      }),
    )
  })

  it('pruning does not change visibility', () => {
    fc.assert(
      fc.property(arbCase, ({ d, answers }) => {
        sameVisibility(computeVisibility(d, pruneAnswers(d, answers)), computeVisibility(d, answers))
      }),
    )
  })

  it('no hidden or non-storing id survives prune', () => {
    fc.assert(
      fc.property(arbCase, ({ d, answers }) => {
        const vis = computeVisibility(d, answers)
        for (const id of Object.keys(pruneAnswers(d, answers))) {
          expect(vis.fields.has(id)).toBe(true)
          expect(d.fields.find((f) => f.id === id)?.type).not.toBe('section_break')
        }
      }),
    )
  })

  it('a pruned submission never fails on visibility', () => {
    const hiddenMsg = 'This question is not shown, so it cannot be answered'
    fc.assert(
      fc.property(arbCase, ({ d, answers }) => {
        const r = validateSubmission(d, pruneAnswers(d, answers))
        if (!r.ok) expect(Object.values(r.errors)).not.toContain(hiddenMsg)
      }),
    )
  })

  it('a valid submission validates to only visible answers', () => {
    fc.assert(
      fc.property(arbCase, ({ d, answers }) => {
        const r = validateSubmission(d, answers, { hidden: 'drop' })
        if (r.ok) {
          const vis = computeVisibility(d, answers)
          for (const id of Object.keys(r.answers)) expect(vis.fields.has(id)).toBe(true)
        }
      }),
    )
  })
})

describe('one response per email', () => {
  const email = { id: 'f_mail', type: 'email', label: 'Work email', required: true }
  const on = { onePerEmail: true, onePerEmailFieldId: 'f_mail' }
  const show = { action: 'show', match: 'all', conditions: [{ field: 'f_ques', op: 'is_yes' }] }
  const yesNo = { id: 'f_ques', type: 'yes_no', label: 'Got one?' }
  const message = (d: FormDefinition, s = on) => lintOnePerEmail(d, s).map((i) => i.message)

  it('passes a required, always-shown email question, or when the setting is off', () => {
    expect(lintOnePerEmail(def([yesNo, email]), on)).toEqual([])
    expect(lintOnePerEmail(def([{ id: 'f_ques', type: 'short_text', label: 'Q' }]), { onePerEmail: false, onePerEmailFieldId: null })).toEqual([])
    // A section break without a rule doesn't hide anything.
    expect(lintOnePerEmail(def([yesNo, { id: 'f_sect', type: 'section_break', label: 'Two' }, email]), on)).toEqual([])
  })

  it('flags an optional, conditional, missing or non-email question', () => {
    const base = 'One response per email needs a required email question that is always shown.'
    const optional = message(def([{ ...email, required: false }]))
    expect(optional).toEqual([`${base} Make "Work email" required, or turn the setting off.`])
    const ruled = lintOnePerEmail(def([yesNo, { ...email, logic: show }]), on)
    expect(ruled).toMatchObject([{ code: 'one_per_email', fieldId: 'f_mail' }])
    expect(ruled[0].message).toContain('Remove the show or hide rule on "Work email"')
    const onPage = message(def([yesNo, { id: 'f_sect', type: 'section_break', label: 'Two', logic: show }, email]))
    expect(onPage[0]).toContain('rule on its page')
    // A rule on an earlier page's break doesn't matter once a later break starts a new page.
    expect(message(def([yesNo, { id: 'f_sect', type: 'section_break', label: 'Two', logic: show }, { id: 'f_sec2', type: 'section_break', label: 'Three' }, email]))).toEqual([])
    expect(lintOnePerEmail(def([yesNo]), on)).toMatchObject([{ fieldId: 'settings' }])
    expect(lintOnePerEmail(def([yesNo]), { onePerEmail: true, onePerEmailFieldId: null })).toHaveLength(1)
    expect(lintOnePerEmail(def([{ id: 'f_mail', type: 'short_text', label: 'Mail', required: true }]), on)).toHaveLength(1)
  })

  it('dedupes on a trimmed, lowercase address without a +tag', () => {
    expect(emailDedupeKey(' Ada+News@Example.COM ')).toBe('ada@example.com')
    expect(emailDedupeKey('ada@example.com')).toBe('ada@example.com')
    expect(emailDedupeKey('ada+@example.com')).toBe('ada@example.com')
    expect(emailDedupeKey('a.b+c+d@x.io')).toBe('a.b@x.io')
    // A local part that is only a tag stays as it is; the domain is never touched.
    expect(emailDedupeKey('+x@example.com')).toBe('+x@example.com')
    expect(emailDedupeKey('ada@ex+ample.com')).toBe('ada@ex+ample.com')
  })
})
