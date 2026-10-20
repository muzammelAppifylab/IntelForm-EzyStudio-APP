import { describe, expect, it } from 'vitest'
import { formDefinition } from '../definition'
import { computeVisibility, lintLogic } from '../logic'
import { defaultFormSettings, formSettings } from '../settings'
import { BUILTIN_TEMPLATE_INPUTS, BUILTIN_TEMPLATES, remapTemplateIds } from './index'

const bySlug = (slug: string) => BUILTIN_TEMPLATES.find((t) => t.slug === slug)!
const types = (slug: string) => bySlug(slug).definition.fields.map((f) => f.type)

describe('built-in templates', () => {
  it('ships the 10 PRD templates with unique, prefixed slugs and order', () => {
    expect(BUILTIN_TEMPLATES).toHaveLength(10)
    expect(BUILTIN_TEMPLATES.every((t) => t.slug.startsWith('builtin-'))).toBe(true)
    expect(new Set(BUILTIN_TEMPLATES.map((t) => t.slug)).size).toBe(10)
    expect(BUILTIN_TEMPLATES.map((t) => t.sortOrder)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })

  it.each(BUILTIN_TEMPLATE_INPUTS.map((t) => [t.slug, t] as const))('%s parses, lints clean and has valid settings', (_slug, t) => {
    const def = formDefinition.parse(t.definition)
    expect(lintLogic(def)).toEqual([])
    const settings = formSettings.parse({ ...defaultFormSettings(), ...t.settings })
    for (const id of [settings.onePerEmailFieldId, settings.confirmationEmailFieldId]) {
      if (id) expect(def.fields.find((f) => f.id === id)?.type).toBe('email')
    }
    expect(def.fields.filter((f) => f.type !== 'section_break').length).toBeGreaterThan(0)
  })

  it('matches the PRD layouts and categories', () => {
    const expected: Record<string, [string, string]> = {
      'builtin-lead-capture': ['Marketing', 'one_at_a_time'],
      'builtin-contact-support': ['Support', 'all_at_once'],
      'builtin-application': ['HR', 'section_by_section'],
      'builtin-survey': ['Research', 'one_at_a_time'],
      'builtin-nps': ['Feedback', 'one_at_a_time'],
      'builtin-event-registration': ['Events', 'all_at_once'],
      'builtin-appointment-request': ['Services', 'section_by_section'],
      'builtin-waitlist': ['Marketing', 'one_at_a_time'],
      'builtin-b2b-enquiry': ['Sales', 'all_at_once'],
      'builtin-post-purchase-feedback': ['Feedback', 'one_at_a_time'],
    }
    for (const t of BUILTIN_TEMPLATES) expect([t.category, t.definition.layout], t.slug).toEqual(expected[t.slug])
  })

  it('has the PRD fields and notes', () => {
    expect(types('builtin-lead-capture')).toEqual(['name', 'email', 'phone', 'short_text', 'single_choice', 'consent'])
    expect(bySlug('builtin-lead-capture').settings.onePerEmail).toBe(true)
    expect(types('builtin-contact-support')).toEqual(['name', 'email', 'dropdown', 'long_text'])
    expect(bySlug('builtin-contact-support').settings.notifyOnResponse).toBe(true)

    const app = types('builtin-application')
    expect(app.filter((t) => t === 'section_break')).toHaveLength(3)
    expect(app.filter((t) => t !== 'section_break')).toEqual(['name', 'email', 'phone', 'address', 'url', 'number', 'long_text', 'date', 'consent'])

    const survey = types('builtin-survey')
    expect(survey.filter((t) => t === 'rating')).toHaveLength(3)
    expect(survey.filter((t) => t === 'single_choice')).toHaveLength(2)
    expect(survey.filter((t) => t === 'multiple_choice')).toHaveLength(1)
    expect(survey.filter((t) => t === 'long_text')).toHaveLength(1)
    expect(bySlug('builtin-survey').definition.startScreen.enabled).toBe(true)

    expect(types('builtin-event-registration')).toEqual(['name', 'email', 'phone', 'single_choice', 'long_text', 'consent'])
    expect(bySlug('builtin-event-registration').settings.onePerEmail).toBe(true)
    expect(types('builtin-appointment-request').filter((t) => t !== 'section_break')).toEqual(['name', 'email', 'phone', 'dropdown', 'date', 'time', 'long_text', 'consent'])
    expect(types('builtin-waitlist')).toEqual(['email', 'name', 'dropdown'])
    expect(bySlug('builtin-waitlist').settings.onePerEmail).toBe(true)

    const b2b = bySlug('builtin-b2b-enquiry')
    expect(types('builtin-b2b-enquiry')).toEqual(['name', 'email', 'short_text', 'dropdown', 'country', 'dropdown', 'long_text'])
    expect(b2b.definition.fields.find((f) => f.type === 'email')?.props).toMatchObject({ blockFreeDomains: true })
    expect(b2b.settings.notifyOnResponse).toBe(true)

    expect(types('builtin-post-purchase-feedback')).toEqual(['rating', 'multiple_choice', 'yes_no', 'long_text'])
    expect(bySlug('builtin-post-purchase-feedback').definition.fields[0].props).toMatchObject({ style: 'stars' })
    expect(bySlug('builtin-post-purchase-feedback').definition.startScreen.enabled).toBe(true)
  })

  it('NPS shows one of two follow-ups by score', () => {
    const def = bySlug('builtin-nps').definition
    expect(types('builtin-nps')).toEqual(['nps', 'long_text', 'long_text', 'email'])
    const visible = (score: number) => computeVisibility(def, { f_npsscore: score }).fields
    for (const score of [0, 6]) {
      expect(visible(score).has('f_npslow')).toBe(true)
      expect(visible(score).has('f_npshigh')).toBe(false)
    }
    for (const score of [7, 10]) {
      expect(visible(score).has('f_npslow')).toBe(false)
      expect(visible(score).has('f_npshigh')).toBe(true)
    }
    expect(def.fields.find((f) => f.type === 'email')?.required).toBe(false)
  })

  it('gives a copy fresh field and option ids and rewrites every reference', () => {
    for (const t of BUILTIN_TEMPLATES) {
      const settings = formSettings.parse(t.settings)
      const { definition, settings: s } = remapTemplateIds(t.definition, settings)
      const copy = formDefinition.parse(definition)
      expect(lintLogic(copy), t.slug).toEqual([])
      const oldIds = new Set(t.definition.fields.map((f) => f.id))
      expect(copy.fields.some((f) => oldIds.has(f.id)), t.slug).toBe(false)
      expect(copy.fields.map((f) => f.type)).toEqual(t.definition.fields.map((f) => f.type))
      if (settings.onePerEmailFieldId) expect(copy.fields.find((f) => f.id === s.onePerEmailFieldId)?.type).toBe('email')
      const json = JSON.stringify(copy)
      for (const id of oldIds) expect(json, `${t.slug} still mentions ${id}`).not.toContain(id)
      for (const f of copy.fields) {
        const before = t.definition.fields.find((x) => x.type === f.type && x.label.replace(/f_[a-z0-9]+/g, '') === f.label.replace(/f_[a-z0-9]+/g, ''))
        const oldOpts = (before?.props as { options?: { id: string }[] } | undefined)?.options
        const newOpts = (f.props as { options?: { id: string }[] }).options
        if (oldOpts && newOpts) expect(newOpts.some((o) => oldOpts.some((p) => p.id === o.id))).toBe(false)
      }
    }
  })

  it('keeps the NPS follow-up logic working after the copy', () => {
    const nps = bySlug('builtin-nps')
    const { definition } = remapTemplateIds(nps.definition, formSettings.parse({}))
    const [score, low, high] = definition.fields
    expect(low.logic?.conditions[0].field).toBe(score.id)
    const visible = computeVisibility(definition, { [score.id]: 3 }).fields
    expect(visible.has(low.id)).toBe(true)
    expect(visible.has(high.id)).toBe(false)
  })

  it('rewrites pipes and choice-option conditions', () => {
    const def = formDefinition.parse({
      layout: 'all_at_once',
      startScreen: { enabled: true, title: 'Hi' },
      fields: [
        { id: 'f_src0', type: 'single_choice', label: 'Pick', props: { options: [{ id: 'o_aa', label: 'A' }, { id: 'o_bb', label: 'B' }], other: true } },
        { id: 'f_tgt0', type: 'short_text', label: 'You picked {f_src0|nothing}', logic: { action: 'show', match: 'any', conditions: [{ field: 'f_src0', op: 'is', value: 'o_bb' }, { field: 'f_src0', op: 'is', value: 'o_other' }] } },
      ],
      endScreen: { title: 'Thanks {f_src0}', message: '' },
    })
    const { definition } = remapTemplateIds(def, formSettings.parse({}))
    const [src, tgt] = definition.fields
    const opts = (src.props as { options: { id: string; label: string }[] }).options
    expect(tgt.label).toBe(`You picked {${src.id}|nothing}`)
    expect(definition.endScreen.title).toBe(`Thanks {${src.id}}`)
    expect(tgt.logic?.conditions[0]).toEqual({ field: src.id, op: 'is', value: opts[1].id })
    expect(tgt.logic?.conditions[1].value).toBe('o_other')
    expect(lintLogic(formDefinition.parse(definition))).toEqual([])
  })
})
