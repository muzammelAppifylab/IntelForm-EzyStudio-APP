import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FormDetail, FormPatchInput, FormPatchResponse } from '../../src/lib/intelform/api-forms'
import { blankDefinition, newField, type FormField } from '../../src/lib/intelform/form/definition'
import { pipeToken } from '../../src/lib/intelform/form/logic'
import { defaultFormSettings, clientSettings } from '../../src/lib/intelform/form/settings'
import { defaultTheme } from '../../src/lib/intelform/form/theme'
import { describeRule } from '../../src/portal/intelform/builder/describe'
import { createBuilderStore, HISTORY_LIMIT, type StoreDeps } from '../../src/portal/intelform/builder/store'

function detail(fields: FormField[] = [], responses = 0): FormDetail {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    title: 'Survey',
    slug: 'abcd1234',
    status: 'draft',
    draft: { ...blankDefinition(), fields },
    theme: defaultTheme(),
    settings: clientSettings(defaultFormSettings(), { canEdit: true }),
    revision: 1,
    publishedVersion: null,
    publishedAt: null,
    hasUnpublished: false,
    createdAt: '',
    updatedAt: '',
    updatedBy: null,
    counts: { fields: fields.length, logicRules: 0, responses },
  }
}

function response(revision: number, extra: Partial<FormPatchResponse> = {}): FormPatchResponse {
  return { revision, overwrote: false, overwrittenBy: null, hasUnpublished: false, slug: 'abcd1234', status: 'draft', ...extra }
}

/** A controllable server: each send waits until the test resolves it. */
function server() {
  const calls: { body: FormPatchInput; revision: number; resolve: (r: FormPatchResponse) => void; reject: (e: unknown) => void }[] = []
  let rev = 1
  const send: StoreDeps['send'] = (body, revision) =>
    new Promise((resolve, reject) => calls.push({ body, revision, resolve, reject }))
  const answer = (i = calls.length - 1, extra: Partial<FormPatchResponse> = {}) => calls[i].resolve(response(++rev, extra))
  return { calls, send, answer }
}

const flushMicro = () => vi.advanceTimersByTimeAsync(0)

describe('undo history', () => {
  let clock = 0
  const make = (fields: FormField[] = []) =>
    createBuilderStore(detail(fields), { send: async (_b, r) => response(r + 1), me: { id: 1 }, readOnly: false, now: () => clock })

  beforeEach(() => {
    vi.useFakeTimers()
    clock = 1000
  })
  afterEach(() => vi.useRealTimers())

  it('coalesces typing in one label into one step, and separates other edits', () => {
    const s = make([newField('short_text', { id: 'f_aaaa1111' })])
    const type = (text: string) => {
      s.getState().updateField('f_aaaa1111', (f) => void (f.label = text), 'label:f_aaaa1111')
      clock += 200
    }
    type('H')
    type('He')
    type('Hel')
    type('Hello')
    expect(s.getState().past).toHaveLength(1)
    clock += 1000 // a pause starts a new step
    type('Hello!')
    expect(s.getState().past).toHaveLength(2)
    s.getState().updateField('f_aaaa1111', (f) => void (f.required = true))
    expect(s.getState().past).toHaveLength(3)

    s.getState().undo()
    expect(s.getState().doc.draft.fields[0].required).toBe(false)
    s.getState().undo()
    expect(s.getState().doc.draft.fields[0].label).toBe('Hello')
    s.getState().undo()
    expect(s.getState().doc.draft.fields[0].label).toBe('')
    s.getState().redo()
    s.getState().redo()
    expect(s.getState().doc.draft.fields[0].label).toBe('Hello!')
    expect(s.getState().future).toHaveLength(1)
  })

  it('a new edit clears redo, and history is capped', () => {
    const s = make()
    s.getState().addField('email')
    s.getState().undo()
    expect(s.getState().future).toHaveLength(1)
    s.getState().addField('nps')
    expect(s.getState().future).toHaveLength(0)
    for (let i = 0; i < HISTORY_LIMIT + 20; i++) s.getState().addField('short_text')
    expect(s.getState().past).toHaveLength(HISTORY_LIMIT)
  })

  it('keeps selection out of history and drops it when undo removes the field', () => {
    const s = make()
    const id = s.getState().addField('email')
    expect(s.getState().selection).toBe(id)
    s.getState().select(null)
    expect(s.getState().past).toHaveLength(1)
    s.getState().select(id)
    s.getState().undo()
    expect(s.getState().selection).toBeNull()
  })

  it('read-only stores ignore edits', () => {
    const s = createBuilderStore(detail(), { send: async () => response(2), me: { id: 1 }, readOnly: true })
    s.getState().addField('email')
    expect(s.getState().doc.draft.fields).toHaveLength(0)
  })

  it('inserts below the selection and moves with the keyboard actions', () => {
    const s = make()
    const a = s.getState().addField('email')
    const c = s.getState().addField('nps')
    s.getState().select(a)
    const b = s.getState().insertBelowSelection('short_text')
    expect(s.getState().doc.draft.fields.map((f) => f.id)).toEqual([a, b, c])
    s.getState().moveBy(c, -2)
    expect(s.getState().doc.draft.fields.map((f) => f.id)).toEqual([c, a, b])
    s.getState().duplicate(a)
    expect(s.getState().doc.draft.fields).toHaveLength(4)
    expect(s.getState().doc.draft.fields[2].type).toBe('email')
  })
})

describe('autosave', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('saves 1 s after the last change with If-Match, single-flight', async () => {
    const srv = server()
    const s = createBuilderStore(detail(), { send: srv.send, me: { id: 1 }, readOnly: false })
    s.getState().addField('email')
    await vi.advanceTimersByTimeAsync(500)
    s.getState().addField('nps')
    await vi.advanceTimersByTimeAsync(900)
    expect(srv.calls).toHaveLength(0)
    expect(s.getState().save.status).toBe('pending')
    await vi.advanceTimersByTimeAsync(100)
    expect(srv.calls).toHaveLength(1)
    expect(srv.calls[0].revision).toBe(1)
    expect((srv.calls[0].body.draft as { fields: unknown[] }).fields).toHaveLength(2)
    expect(srv.calls[0].body.theme).toBeUndefined()
    expect(s.getState().save.status).toBe('saving')

    // Changes while the save is in flight wait for it: never two requests at once.
    s.getState().addField('rating')
    await vi.advanceTimersByTimeAsync(3000)
    s.getState().addField('date')
    await vi.advanceTimersByTimeAsync(3000)
    expect(srv.calls).toHaveLength(1)

    srv.answer()
    await flushMicro()
    await vi.advanceTimersByTimeAsync(1000)
    expect(srv.calls).toHaveLength(2)
    expect(srv.calls[1].revision).toBe(2)
    expect((srv.calls[1].body.draft as { fields: unknown[] }).fields).toHaveLength(4)
    srv.answer()
    await flushMicro()
    await vi.advanceTimersByTimeAsync(5000)
    expect(srv.calls).toHaveLength(2)
    expect(s.getState().save.status).toBe('saved')
  })

  it('goes offline and retries with backoff, then saves', async () => {
    const srv = server()
    const s = createBuilderStore(detail(), { send: srv.send, me: { id: 1 }, readOnly: false, backoffMs: (n) => 2000 * 2 ** n })
    s.getState().addField('email')
    await vi.advanceTimersByTimeAsync(1000)
    srv.calls[0].reject({ status: 0, message: 'offline' })
    await flushMicro()
    expect(s.getState().save.status).toBe('offline')
    await vi.advanceTimersByTimeAsync(1999)
    expect(srv.calls).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(srv.calls).toHaveLength(2)
    srv.calls[1].reject({ status: 503, message: 'down' })
    await flushMicro()
    await vi.advanceTimersByTimeAsync(3999)
    expect(srv.calls).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(1)
    srv.answer()
    await flushMicro()
    expect(s.getState().save.status).toBe('saved')
  })

  it('shows the other editor when the save overwrote theirs', async () => {
    const srv = server()
    const s = createBuilderStore(detail(), { send: srv.send, me: { id: 1 }, readOnly: false })
    s.getState().commit('Rename', (d) => void (d.title = 'New'))
    await vi.advanceTimersByTimeAsync(1000)
    expect(srv.calls[0].body).toEqual({ title: 'New' })
    srv.answer(0, { overwrote: true, overwrittenBy: { id: 2, name: 'Sam' } })
    await flushMicro()
    expect(s.getState().banner).toEqual({ kind: 'overwrote', name: 'Sam' })
  })

  it('settings ride the same queue and roll back on error', async () => {
    const srv = server()
    const s = createBuilderStore(detail(), { send: srv.send, me: { id: 1 }, readOnly: false })
    const p = s.getState().patchSettings({ closedMessage: 'By' })
    const p2 = s.getState().patchSettings({ closedMessage: 'Bye', onePerBrowser: true })
    expect(s.getState().settings.closedMessage).toBe('Bye')
    await vi.advanceTimersByTimeAsync(200)
    // A burst of settings changes becomes one request.
    expect(srv.calls).toHaveLength(1)
    expect(srv.calls[0].body).toEqual({ settings: { closedMessage: 'Bye', onePerBrowser: true } })
    void p2.catch(() => {})
    srv.calls[0].reject({ status: 422, message: 'Bad' })
    await expect(p).rejects.toMatchObject({ status: 422 })
    expect(s.getState().settings.closedMessage).not.toBe('Bye')
  })

  it('flush saves pending changes at once', async () => {
    const sent: FormPatchInput[] = []
    const s = createBuilderStore(detail(), {
      send: async (b, r) => (sent.push(b), response(r + 1)),
      me: { id: 1 },
      readOnly: false,
    })
    s.getState().addField('email')
    await s.getState().flush()
    expect(sent).toHaveLength(1)
    expect(s.queue.revision).toBe(2)
    expect(s.queue.dirty).toBe(false)
  })
})

describe('type change', () => {
  it('keeps the id without responses and maps compatible settings', () => {
    const f = newField('single_choice', { id: 'f_src00001', label: 'Pick one' })
    const s = createBuilderStore(detail([f]), { send: async () => response(2), me: { id: 1 }, readOnly: false })
    s.getState().setType('f_src00001', 'dropdown', false)
    const next = s.getState().doc.draft.fields[0]
    expect(next.id).toBe('f_src00001')
    expect(next.type).toBe('dropdown')
    expect(next.label).toBe('Pick one')
    expect(next.type === 'dropdown' && next.props.options.map((o) => o.id)).toEqual(f.props.options.map((o) => o.id))
  })

  it('gets a fresh id with responses, and rules and pipes follow it', () => {
    const src = newField('short_text', { id: 'f_src00001', label: 'Name' })
    const target = newField('long_text', {
      id: 'f_tgt00001',
      label: `Thanks ${pipeToken('f_src00001', undefined, 'there')}`,
      logic: { action: 'show', match: 'all', conditions: [{ field: 'f_src00001', op: 'is_not_empty' }] },
    })
    const s = createBuilderStore(detail([src, target], 3), { send: async () => response(2), me: { id: 1 }, readOnly: false })
    s.getState().select('f_src00001')
    s.getState().setType('f_src00001', 'email', true)
    const [a, b] = s.getState().doc.draft.fields
    expect(a.id).not.toBe('f_src00001')
    expect(a.type).toBe('email')
    expect(b.logic?.conditions[0].field).toBe(a.id)
    expect(b.label).toBe(`Thanks {${a.id}|there}`)
    expect(s.getState().selection).toBe(a.id)
  })

  it('deleting a field removes the conditions that used it', () => {
    const src = newField('nps', { id: 'f_src00001', label: 'NPS' })
    const target = newField('long_text', {
      id: 'f_tgt00001',
      logic: { action: 'show', match: 'all', conditions: [{ field: 'f_src00001', op: 'lte', value: 6 }] },
    })
    const def = { ...blankDefinition(), fields: [src, target] }
    expect(describeRule(def, target.logic!)).toBe('Shown when NPS ≤ 6')
    const s = createBuilderStore(detail([src, target]), { send: async () => response(2), me: { id: 1 }, readOnly: false })
    s.getState().remove('f_src00001')
    expect(s.getState().doc.draft.fields[0].logic).toBeUndefined()
  })
})
