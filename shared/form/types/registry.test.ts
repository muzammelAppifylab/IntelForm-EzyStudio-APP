import { describe, expect, it } from 'vitest'
import type { ConditionOp } from '../base'
import { changeFieldType, newField, type FormField } from '../definition'
import { FIELD_TYPES, FIELD_TYPE_META, type FieldType } from '../field-types'
import { configureValidators } from './common'
import { coreRegistry } from './registry'

const opt = (option: string, other?: string) => (other === undefined ? { option } : { option, other })

function fieldOf(type: FieldType, props: Record<string, unknown> = {}, extra: Partial<FormField> = {}): FormField {
  const f = newField(type, { id: 'f_test1', label: 'Q', ...extra } as never)
  return { ...f, props: { ...(f.props as object), ...props } } as FormField
}

const choiceProps = { options: [{ id: 'o_a1', label: 'Alpha' }, { id: 'o_b2', label: 'Beta' }], other: true }

/** [type, props, op, answer, value, expected] */
type Case = [FieldType, Record<string, unknown>, ConditionOp, unknown, unknown, boolean]

const cases: Case[] = [
  // text-like
  ['short_text', {}, 'is', 'Hello  World', 'hello world', true],
  ['short_text', {}, 'is', 'Hello', 'bye', false],
  ['short_text', {}, 'is_not', 'Hello', 'bye', true],
  ['short_text', {}, 'is_not', '', 'bye', false],
  ['short_text', {}, 'contains', 'Hello world', 'WOR', true],
  ['short_text', {}, 'contains', 'Hello', 'x', false],
  ['short_text', {}, 'not_contains', 'Hello', 'x', true],
  ['short_text', {}, 'not_contains', undefined, 'x', false],
  ['short_text', {}, 'is_empty', '   ', undefined, true],
  ['short_text', {}, 'is_not_empty', 'a', undefined, true],
  ['long_text', {}, 'contains', 'line one\nline two', 'two', true],
  ['long_text', {}, 'is_empty', undefined, undefined, true],
  ['email', {}, 'contains', 'sam@acme.com', '@acme.com', true],
  ['email', {}, 'is', 'Sam@Acme.com', 'sam@acme.com', true],
  ['email', {}, 'is_empty', '', undefined, true],
  ['url', {}, 'contains', 'https://acme.com', 'acme', true],
  ['url', {}, 'is_not_empty', '', undefined, false],
  ['phone', {}, 'is', '+44 20 7946 0958', '+442079460958', true],
  ['phone', {}, 'is_not', '+442079460958', '+15551234567', true],
  ['phone', {}, 'contains', '+442079460958', '+44', true],
  ['phone', {}, 'is', '', '+44', false],
  ['name', { split: true }, 'is', { first: 'Ada', last: 'Lovelace' }, 'ada lovelace', true],
  ['name', { split: true }, 'contains', { first: 'Ada', last: 'Lovelace' }, 'love', true],
  ['name', { split: true }, 'is_empty', { first: ' ', last: '' }, undefined, true],
  ['name', { split: false }, 'is_not_empty', 'Ada', undefined, true],
  ['name', {}, 'is_not', undefined, 'x', false],
  ['address', {}, 'contains', { street: '1 Main St', city: 'Leeds', country: 'GB' }, 'leeds', true],
  ['address', {}, 'is_empty', { street: '' }, undefined, true],
  ['address', {}, 'is_not_empty', { city: 'Leeds' }, undefined, true],
  // number-like
  ['number', {}, 'eq', 5, 5, true],
  ['number', {}, 'eq', 5, '5', true],
  ['number', {}, 'neq', 5, 6, true],
  ['number', {}, 'gt', 5, 4, true],
  ['number', {}, 'gt', 5, 5, false],
  ['number', {}, 'gte', 5, 5, true],
  ['number', {}, 'lt', 3, 5, true],
  ['number', {}, 'lte', 5, 5, true],
  ['number', {}, 'lt', undefined, 5, false],
  ['number', {}, 'neq', undefined, 5, false],
  ['number', {}, 'is_empty', '', undefined, true],
  ['number', {}, 'eq', 5, 'abc', false],
  ['rating', {}, 'gte', 4, 4, true],
  ['rating', {}, 'lt', 2, 3, true],
  ['rating', {}, 'is_empty', undefined, undefined, true],
  ['nps', {}, 'lte', 6, 6, true],
  ['nps', {}, 'gte', 9, 9, true],
  ['nps', {}, 'eq', 0, 0, true],
  ['nps', {}, 'is_not_empty', 0, undefined, true],
  // date / time
  ['date', {}, 'is', '2026-10-19', '2026-10-19', true],
  ['date', {}, 'before', '2026-10-18', '2026-10-19', true],
  ['date', {}, 'after', '2026-10-18', '2026-10-19', false],
  ['date', {}, 'after', '2027-01-01', '2026-12-31', true],
  ['date', {}, 'before', undefined, '2026-10-19', false],
  ['date', {}, 'is_empty', 'not-a-date', undefined, true],
  ['time', {}, 'before', '09:00', '10:30', true],
  ['time', {}, 'after', '23:45', '10:30', true],
  ['time', {}, 'is', '10:30', '10:30', true],
  ['time', {}, 'is_empty', undefined, undefined, true],
  // single choice, dropdown, country
  ['single_choice', choiceProps, 'is', opt('o_a1'), 'o_a1', true],
  ['single_choice', choiceProps, 'is', opt('o_b2'), 'o_a1', false],
  ['single_choice', choiceProps, 'is_not', opt('o_b2'), 'o_a1', true],
  ['single_choice', choiceProps, 'is_not', undefined, 'o_a1', false],
  ['single_choice', choiceProps, 'is', opt('o_other', 'Radio'), 'o_other', true],
  ['single_choice', choiceProps, 'is_empty', undefined, undefined, true],
  ['dropdown', choiceProps, 'is', opt('o_b2'), 'o_b2', true],
  ['dropdown', choiceProps, 'is_not_empty', opt('o_b2'), undefined, true],
  ['country', {}, 'is', 'GB', 'gb', true],
  ['country', {}, 'is_not', 'GB', 'US', true],
  ['country', {}, 'is_not', '', 'US', false],
  ['country', {}, 'is_empty', '', undefined, true],
  // multiple / picture choice
  ['multiple_choice', choiceProps, 'includes', [opt('o_a1'), opt('o_b2')], 'o_b2', true],
  ['multiple_choice', choiceProps, 'includes', [opt('o_a1')], 'o_b2', false],
  ['multiple_choice', choiceProps, 'not_includes', [opt('o_a1')], 'o_b2', true],
  ['multiple_choice', choiceProps, 'not_includes', [], 'o_b2', false],
  ['multiple_choice', choiceProps, 'is_empty', [], undefined, true],
  ['picture_choice', choiceProps, 'includes', [opt('o_a1')], 'o_a1', true],
  ['picture_choice', choiceProps, 'is_not_empty', [opt('o_a1')], undefined, true],
  // booleans
  ['yes_no', {}, 'is_yes', true, undefined, true],
  ['yes_no', {}, 'is_no', true, undefined, false],
  ['yes_no', {}, 'is_no', false, undefined, true],
  ['yes_no', {}, 'is_no', undefined, undefined, false],
  ['consent', {}, 'is_yes', { accepted: true, at: '2026-10-19T10:00:00Z' }, undefined, true],
  ['consent', {}, 'is_no', undefined, undefined, true],
  ['consent', {}, 'is_yes', undefined, undefined, false],
  // presence-only
  ['signature', {}, 'is_not_empty', { url: 'https://cdn.example.com/s.png' }, undefined, true],
  ['signature', {}, 'is_empty', undefined, undefined, true],
  // remaining type × operator pairs
  ['email', {}, 'is_not', 'a@b.co', 'c@d.co', true],
  ['email', {}, 'not_contains', 'a@b.co', 'gmail', true],
  ['email', {}, 'is_not_empty', 'a@b.co', undefined, true],
  ['name', {}, 'not_contains', 'Ada', 'Bob', true],
  ['phone', {}, 'not_contains', '+442079460958', '+1', true],
  ['phone', {}, 'is_empty', '', undefined, true],
  ['phone', {}, 'is_not_empty', '+442079460958', undefined, true],
  ['address', {}, 'is', { street: '1 Main St', city: 'Leeds' }, '1 main st, leeds', true],
  ['address', {}, 'is_not', { city: 'Leeds' }, 'york', true],
  ['address', {}, 'not_contains', { city: 'Leeds' }, 'york', true],
  ['country', {}, 'is_not_empty', 'GB', undefined, true],
  ['long_text', {}, 'is', 'Yes', 'yes', true],
  ['long_text', {}, 'is_not', 'Yes', 'no', true],
  ['long_text', {}, 'not_contains', 'Yes', 'no', true],
  ['long_text', {}, 'is_not_empty', '', undefined, false],
  ['number', {}, 'is_not_empty', 0, undefined, true],
  ['url', {}, 'is', 'https://acme.com', 'HTTPS://ACME.COM', true],
  ['url', {}, 'is_not', 'https://acme.com', 'https://b.com', true],
  ['url', {}, 'not_contains', 'https://acme.com', 'evil', true],
  ['url', {}, 'is_empty', undefined, undefined, true],
  ['date', {}, 'is_not_empty', '2026-10-19', undefined, true],
  ['time', {}, 'is_not_empty', '10:30', undefined, true],
  ['single_choice', choiceProps, 'is_not_empty', opt('o_a1'), undefined, true],
  ['multiple_choice', choiceProps, 'is_not_empty', [], undefined, false],
  ['dropdown', choiceProps, 'is_not', opt('o_a1'), 'o_b2', true],
  ['dropdown', choiceProps, 'is_empty', { option: '' }, undefined, true],
  ['picture_choice', choiceProps, 'not_includes', [opt('o_a1')], 'o_b2', true],
  ['picture_choice', choiceProps, 'is_empty', undefined, undefined, true],
  ['rating', {}, 'eq', 3, 3, true],
  ['rating', {}, 'neq', 3, 3, false],
  ['rating', {}, 'gt', 3, 2, true],
  ['rating', {}, 'lte', 3, 2, false],
  ['rating', {}, 'is_not_empty', 1, undefined, true],
  ['nps', {}, 'neq', 7, 8, true],
  ['nps', {}, 'gt', 10, 9, true],
  ['nps', {}, 'lt', 6, 7, true],
  ['nps', {}, 'is_empty', null, undefined, true],
]

describe('operators', () => {
  it.each(cases)('%s %o: %s(%j, %j) = %s', (type, props, op, answer, value, expected) => {
    const core = coreRegistry[type]
    expect(core.operators).toContain(op)
    expect(core.evaluate(op, answer, value, fieldOf(type, props))).toBe(expected)
  })

  it('every storing type has a case for each of its operators', () => {
    const missing: string[] = []
    for (const type of FIELD_TYPES) {
      if (!FIELD_TYPE_META[type].stores) continue
      for (const op of coreRegistry[type].operators) {
        if (!cases.some(([t, , o]) => t === type && o === op)) missing.push(`${type} ${op}`)
      }
    }
    expect(missing).toEqual([])
  })

  it('section break has no operators and never matches', () => {
    expect(coreRegistry.section_break.operators).toEqual([])
    expect(coreRegistry.section_break.evaluate('is_empty', undefined, undefined, fieldOf('section_break'))).toBe(false)
  })

  it('operators not offered by a type never match through evaluate', () => {
    expect(coreRegistry.number.evaluate('contains', 5, '5', fieldOf('number'))).toBe(false)
  })
})

describe('registry shape', () => {
  it('covers all 21 types and matches FIELD_TYPE_META', () => {
    expect(Object.keys(coreRegistry).sort()).toEqual([...FIELD_TYPES].sort())
    for (const t of FIELD_TYPES) {
      expect(coreRegistry[t].type).toBe(t)
      expect(coreRegistry[t].stores).toBe(FIELD_TYPE_META[t].stores)
      expect(coreRegistry[t].props.safeParse(coreRegistry[t].defaultProps()).success).toBe(true)
    }
  })

  it('isEmpty treats undefined as empty for every type', () => {
    for (const t of FIELD_TYPES) expect(coreRegistry[t].isEmpty(undefined)).toBe(true)
  })

  it('csv width matches csvColumns for every type', () => {
    for (const t of FIELD_TYPES) {
      const f = fieldOf(t)
      expect(coreRegistry[t].csv(undefined, f).length).toBe(coreRegistry[t].csvColumns(f).length)
    }
  })
})

/** [type, props, input, ok, normalised output or error code] */
type AnswerCase = [FieldType, Record<string, unknown>, unknown, boolean, unknown]

const answers: AnswerCase[] = [
  ['email', {}, '  Sam@Example.COM ', true, 'sam@example.com'],
  ['email', {}, 'not-an-email', false, 'invalidEmail'],
  ['name', { split: true }, { first: ' Ada ', last: 'Lovelace' }, true, { first: 'Ada', last: 'Lovelace' }],
  ['name', { split: false }, ' Ada Lovelace ', true, 'Ada Lovelace'],
  ['name', { split: true }, 'Ada', false, 'invalid'],
  ['phone', {}, '+44 20 7946 0958', true, '+442079460958'],
  ['phone', {}, '020 7946 0958', false, 'invalidPhone'],
  ['address', { lines: { street: true, line2: false, city: true, state: false, postal: true, country: true } }, { street: '1 Main', line2: 'x', city: 'Leeds', country: 'GB', postal: '' }, true, { street: '1 Main', city: 'Leeds', country: 'GB' }],
  ['address', {}, { street: '1 Main', country: 'XX' }, false, 'invalidCountry'],
  ['country', {}, 'gb', true, 'GB'],
  ['country', { limitTo: ['US', 'CA'] }, 'GB', false, 'invalidCountry'],
  ['short_text', { minLength: 3 }, 'ab', false, 'minChars:3'],
  ['short_text', { maxLength: 3 }, 'abcd', false, 'maxChars:3'],
  ['short_text', {}, '  hi  ', true, 'hi'],
  ['long_text', {}, 'x'.repeat(10001), false, 'maxChars:10000'],
  ['number', { min: 1, max: 10 }, 11, false, 'numberMax:10'],
  ['number', { min: 1, max: 10 }, 0, false, 'numberMin:1'],
  ['number', { allowDecimals: false }, 1.5, false, 'wholeNumber'],
  ['number', {}, '12.5', true, 12.5],
  ['number', {}, 'abc', false, 'invalidNumber'],
  ['url', {}, 'acme.com/x', true, 'https://acme.com/x'],
  ['url', {}, 'javascript:alert(1)', false, 'invalidUrl'],
  ['url', {}, 'https://localhost', false, 'invalidUrl'],
  ['date', {}, '2026-02-29', false, 'invalidDate'],
  ['date', {}, '2028-02-29', true, '2028-02-29'],
  ['date', { minDate: '2026-01-01', format: 'DD/MM/YYYY' }, '2025-12-31', false, 'dateMin:01/01/2026'],
  ['time', { step: 15 }, '09:30', true, '09:30'],
  ['time', { step: 15 }, '09:31', false, 'timeStep:15'],
  ['time', {}, '24:00', false, 'invalidTime'],
  ['single_choice', choiceProps, { option: 'o_a1', other: 'ignored' }, true, { option: 'o_a1' }],
  ['single_choice', choiceProps, { option: 'o_zz' }, false, 'invalidChoice'],
  ['single_choice', choiceProps, { option: 'o_other', other: ' Radio ' }, true, { option: 'o_other', other: 'Radio' }],
  ['single_choice', choiceProps, { option: 'o_other', other: ' ' }, false, 'otherRequired'],
  ['single_choice', { ...choiceProps, other: false }, { option: 'o_other', other: 'x' }, false, 'invalidChoice'],
  ['single_choice', choiceProps, 'o_a1', false, 'invalidChoice'],
  ['dropdown', choiceProps, { option: 'o_b2' }, true, { option: 'o_b2' }],
  ['multiple_choice', { ...choiceProps, minSelections: 2 }, [{ option: 'o_a1' }], false, 'chooseAtLeast:2'],
  ['multiple_choice', { ...choiceProps, maxSelections: 1 }, [{ option: 'o_a1' }, { option: 'o_b2' }], false, 'chooseAtMost:1'],
  ['multiple_choice', choiceProps, [{ option: 'o_a1' }, { option: 'o_a1' }], false, 'invalidChoice'],
  ['picture_choice', { options: choiceProps.options, multiple: false }, [{ option: 'o_a1' }, { option: 'o_b2' }], false, 'chooseAtMost:1'],
  ['picture_choice', { options: choiceProps.options, multiple: true }, [{ option: 'o_a1' }, { option: 'o_b2' }], true, [{ option: 'o_a1' }, { option: 'o_b2' }]],
  ['yes_no', {}, false, true, false],
  ['yes_no', {}, 'yes', false, 'invalidChoice'],
  ['rating', { scale: 5 }, 6, false, 'invalidRating'],
  ['rating', { scale: 5 }, 5, true, 5],
  ['nps', {}, 0, true, 0],
  ['nps', {}, 11, false, 'invalidRating'],
  ['signature', {}, { url: 'data:image/png;base64,iVBORw0KGgo=' }, true, { url: 'data:image/png;base64,iVBORw0KGgo=' }],
  // Only the browser's data URL validates (agent L): a client-supplied https URL is rejected.
  ['signature', {}, { url: 'https://cdn.example.com/sig.png' }, false, 'invalidSignature'],
  ['signature', {}, { url: 'data:text/html;base64,PHNjcmlwdD4=' }, false, 'invalidSignature'],
  ['consent', {}, { accepted: false }, false, 'consentRequired'],
]

describe('answer schemas', () => {
  it.each(answers)('%s %o ← %j', (type, props, input, ok, expected) => {
    const r = coreRegistry[type].answer(fieldOf(type, props), { today: '2026-10-19' }).safeParse(input)
    expect(r.success).toBe(ok)
    if (r.success) expect(r.data).toEqual(expected)
    else expect(r.error.issues[0].message).toBe(expected)
  })

  it('consent output carries the field text and server stamps', () => {
    const f = fieldOf('consent', { text: 'I agree' })
    const now = new Date('2026-10-19T12:00:00.000Z')
    const r = coreRegistry.consent.answer(f, { now, formVersion: 3 }).parse({ accepted: true, at: '2020-01-01T00:00:00Z' })
    expect(r).toEqual({ accepted: true, at: '2026-10-19T12:00:00.000Z', text: 'I agree', version: 3 })
  })

  it('date disable past / future honours today and tolerance', () => {
    const f = fieldOf('date', { disablePast: true, disableFuture: false })
    const schema = (t: number) => coreRegistry.date.answer(f, { today: '2026-10-19', dayTolerance: t })
    expect(schema(0).safeParse('2026-10-18').success).toBe(false)
    expect(schema(1).safeParse('2026-10-18').success).toBe(true)
    const future = fieldOf('date', { disableFuture: true })
    expect(coreRegistry.date.answer(future, { today: '2026-10-19', dayTolerance: 0 }).safeParse('2026-10-20').success).toBe(false)
  })

  it('split name requires a first name when the field is required', () => {
    const f = fieldOf('name', { split: true }, { required: true })
    const r = coreRegistry.name.answer(f).safeParse({ first: '', last: 'Lovelace' })
    expect(r.success).toBe(false)
  })

  it('phone and free-email validators plug in without bundling', () => {
    const phone = fieldOf('phone')
    const email = fieldOf('email', { blockFreeDomains: true })
    const ctx = {
      validators: { phone: (v: string) => v.startsWith('+44'), isFreeEmailDomain: (d: string) => d === 'gmail.com' },
    }
    expect(coreRegistry.phone.answer(phone, ctx).safeParse('+15551234567').success).toBe(false)
    expect(coreRegistry.phone.answer(phone, ctx).safeParse('+442079460958').success).toBe(true)
    const r = coreRegistry.email.answer(email, ctx).safeParse('me@Gmail.com')
    expect(r.success ? '' : r.error.issues[0].message).toBe('freeEmail')
    expect(coreRegistry.email.answer(email, ctx).safeParse('me@acme.com').success).toBe(true)
    // Global configuration (what the server does once at boot).
    configureValidators({ isFreeEmailDomain: (d) => d === 'yahoo.com' })
    expect(coreRegistry.email.answer(email).safeParse('me@yahoo.com').success).toBe(false)
    configureValidators({ isFreeEmailDomain: undefined })
    expect(coreRegistry.email.answer(email).safeParse('me@yahoo.com').success).toBe(true)
  })
})

describe('pipes and csv', () => {
  it('pipes name and address parts', () => {
    const n = fieldOf('name', { split: true })
    expect(coreRegistry.name.pipeParts(n)).toEqual(['first', 'last'])
    expect(coreRegistry.name.pipe({ first: 'Ada', last: 'Lovelace' }, 'first', n)).toBe('Ada')
    expect(coreRegistry.name.pipe({ first: 'Ada', last: 'Lovelace' }, undefined, n)).toBe('Ada Lovelace')
    expect(coreRegistry.name.pipe('Ada Lovelace', 'last', fieldOf('name'))).toBe('Lovelace')
    const a = fieldOf('address')
    expect(coreRegistry.address.pipe({ city: 'Leeds', country: 'GB' }, 'city', a)).toBe('Leeds')
    expect(coreRegistry.address.pipe({ city: 'Leeds', country: 'GB' }, 'country', a)).toBe('United Kingdom')
  })

  it('pipes choice labels, dates and numbers', () => {
    expect(coreRegistry.single_choice.pipe(opt('o_b2'), undefined, fieldOf('single_choice', choiceProps))).toBe('Beta')
    expect(coreRegistry.single_choice.pipe(opt('o_other', 'Radio'), undefined, fieldOf('single_choice', choiceProps))).toBe('Radio')
    expect(coreRegistry.date.pipe('2026-10-19', undefined, fieldOf('date', { format: 'MM/DD/YYYY' }))).toBe('10/19/2026')
    expect(coreRegistry.time.pipe('14:05', undefined, fieldOf('time', { hourCycle: '12' }))).toBe('2:05 PM')
    expect(coreRegistry.number.pipe(9.5, undefined, fieldOf('number', { prefix: '$' }))).toBe('$9.5')
  })
})

describe('type change migration', () => {
  const kept = { label: 'Pick one', description: 'Help text', required: true, requiredError: 'Please pick' }

  it.each(FIELD_TYPES.flatMap((from) => FIELD_TYPES.map((to) => [from, to] as const)))('%s → %s keeps label, description, required', (from, to) => {
    const f = newField(from, kept as never)
    const next = changeFieldType(f, to)
    expect(next.type).toBe(to)
    expect(next.id).toBe(f.id)
    expect(next.label).toBe(kept.label)
    expect(next.description).toBe(kept.description)
    expect(next.required).toBe(to !== 'section_break' || from === 'section_break')
    expect(coreRegistry[to].props.safeParse(next.props).success).toBe(true)
  })

  it('choice → choice keeps the options and their ids', () => {
    const f = fieldOf('single_choice', choiceProps)
    for (const to of ['multiple_choice', 'dropdown', 'picture_choice'] as const) {
      const next = changeFieldType(f, to) as FormField
      expect((next.props as { options: { id: string }[] }).options.map((o) => o.id)).toEqual(['o_a1', 'o_b2'])
    }
    expect((changeFieldType(f, 'multiple_choice').props as { other: boolean }).other).toBe(true)
  })

  it('short → long text keeps the length limits; placeholder dropped for types without one', () => {
    const f = fieldOf('short_text', { minLength: 2, maxLength: 50 }, { placeholder: 'Type here' })
    const long = changeFieldType(f, 'long_text')
    expect(long.props).toMatchObject({ minLength: 2, maxLength: 50 })
    expect(long.placeholder).toBe('Type here')
    expect(changeFieldType(f, 'rating').placeholder).toBeUndefined()
  })
})
