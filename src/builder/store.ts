import { produce, type Draft } from 'immer'
import { createStore, type StoreApi } from 'zustand/vanilla'
import { useStore } from 'zustand'
import { createContext, useContext } from 'react'
import type { FormDetail, FormPatchInput, FormPatchResponse, FormStatus } from '@shared/api-forms'
import type { FormDefinition, FormField } from '@shared/form/definition'
import type { FieldType } from '@shared/form/field-types'
import type { ClientFormSettings, FormSettingsPatch } from '@shared/form/settings'
import { AutosaveQueue, type Doc, type SaveError, type SaveStatus } from './autosave'
import { dependentsOf } from '@shared/form/logic'
import { changeType, createField, duplicateField, indexOfField, insertField, moveField, removeField, type FieldDefaults } from './ops'

export type { Doc, SaveStatus } from './autosave'

export const HISTORY_LIMIT = 100
/** Edits with the same coalesce key within this window become one undo step. */
export const COALESCE_MS = 800

/** "start" and "end" select the screen cards; null is the form-level panel. */
export type Selection = string | null

interface HistoryEntry {
  doc: Doc
  label: string
}

export interface FormMeta {
  id: string
  slug: string
  status: FormStatus
  publishedVersion: number | null
  publishedAt: string | null
  hasUnpublished: boolean
  responses: number
}

export interface Banner {
  kind: 'overwrote' | 'newer'
  name: string
}

export interface BuilderState {
  meta: FormMeta
  doc: Doc
  settings: ClientFormSettings
  readOnly: boolean
  selection: Selection
  past: HistoryEntry[]
  future: HistoryEntry[]
  lastKey: string | null
  lastAt: number
  save: { status: SaveStatus; error: SaveError | null; savedAt: number | null }
  banner: Banner | null
  others: { userId: string; name: string; self: boolean }[]
  /** A field waiting for the "it has dependents" confirmation. */
  pendingDelete: string | null
  /** A just-added field whose label editor should take focus. */
  autoFocus: string | null
}

export interface BuilderActions {
  /** Every document edit goes through here: one undo step, coalesced by `key` while typing. */
  commit(label: string, recipe: (doc: Draft<Doc>) => void, key?: string): void
  undo(): void
  redo(): void
  select(id: Selection): void
  addField(type: FieldType, index?: number): string
  /** Inserts below the selected field (or at the end). */
  insertBelowSelection(type: FieldType): string
  updateField(id: string, recipe: (f: Draft<FormField>) => void, key?: string, label?: string): void
  duplicate(id: string): void
  remove(id: string): void
  /** Deletes at once, or asks first when rules or answer chips depend on the field. */
  requestDelete(id: string): void
  cancelDelete(): void
  move(id: string, to: number): void
  moveBy(id: string, delta: number): void
  setType(id: string, type: FieldType, freshId: boolean): void
  /** Settings are not part of undo; they save through the same queue. */
  patchSettings(patch: FormSettingsPatch): Promise<FormPatchResponse>
  patchSlug(slug: string): Promise<FormPatchResponse>
  setMeta(meta: Partial<FormMeta>): void
  setOthers(others: BuilderState['others']): void
  setBanner(b: Banner | null): void
  flush(): Promise<void>
  dispose(): void
}

export type BuilderStore = StoreApi<BuilderState & BuilderActions> & { queue: AutosaveQueue }

export interface StoreDeps {
  send(body: FormPatchInput, revision: number): Promise<FormPatchResponse>
  me: { id: string }
  readOnly: boolean
  /** App settings defaults for new fields, read when a field is added. */
  fieldDefaults?: () => FieldDefaults
  debounceMs?: number
  backoffMs?: (attempt: number) => number
  now?: () => number
}

export function createBuilderStore(detail: FormDetail, deps: StoreDeps): BuilderStore {
  const now = deps.now ?? Date.now
  let queue!: AutosaveQueue

  const store = createStore<BuilderState & BuilderActions>()((set, get) => {
    const commit: BuilderActions['commit'] = (label, recipe, key) => {
      if (get().readOnly) return
      const prev = get().doc
      // Recipes mutate the draft; a value they happen to return is ignored.
      const next = produce(prev, (d) => {
        recipe(d)
      })
      if (next === prev) return
      const t = now()
      const s = get()
      const coalesce = key !== undefined && s.lastKey === key && t - s.lastAt < COALESCE_MS && s.past.length > 0
      set({
        doc: next,
        past: coalesce ? s.past : [...s.past, { doc: prev, label }].slice(-HISTORY_LIMIT),
        future: [],
        lastKey: key ?? null,
        lastAt: t,
      })
      queue.changed()
    }

    const draftOf = (fn: (def: FormDefinition) => void) => (doc: Draft<Doc>) => fn(doc.draft as FormDefinition)

    const keepSelection = (doc: Doc, sel: Selection): Selection =>
      sel && sel !== 'start' && sel !== 'end' && !doc.draft.fields.some((f) => f.id === sel) ? null : sel

    return {
      meta: {
        id: detail.id,
        slug: detail.slug,
        status: detail.status,
        publishedVersion: detail.publishedVersion,
        publishedAt: detail.publishedAt,
        hasUnpublished: detail.hasUnpublished,
        responses: detail.counts.responses,
      },
      doc: { title: detail.title, draft: detail.draft, theme: detail.theme },
      settings: detail.settings,
      readOnly: deps.readOnly,
      selection: null,
      past: [],
      future: [],
      lastKey: null,
      lastAt: 0,
      save: { status: 'saved', error: null, savedAt: null },
      banner: null,
      others: [],
      pendingDelete: null,
      autoFocus: null,

      commit,
      undo() {
        const s = get()
        const entry = s.past.at(-1)
        if (!entry || s.readOnly) return
        set({
          doc: entry.doc,
          past: s.past.slice(0, -1),
          future: [...s.future, { doc: s.doc, label: entry.label }],
          lastKey: null,
          selection: keepSelection(entry.doc, s.selection),
        })
        queue.changed()
      },
      redo() {
        const s = get()
        const entry = s.future.at(-1)
        if (!entry || s.readOnly) return
        set({
          doc: entry.doc,
          future: s.future.slice(0, -1),
          past: [...s.past, { doc: s.doc, label: entry.label }],
          lastKey: null,
          selection: keepSelection(entry.doc, s.selection),
        })
        queue.changed()
      },
      select(id) {
        if (get().selection !== id) set({ selection: id, lastKey: null, autoFocus: get().autoFocus === id ? id : null })
      },
      addField(type, index) {
        const field = createField(type, deps.fieldDefaults?.())
        commit('Add question', draftOf((def) => void insertField(def, field, index)))
        set({ selection: field.id, autoFocus: field.id })
        return field.id
      },
      insertBelowSelection(type) {
        const { selection, doc } = get()
        if (selection === 'start') return get().addField(type, 0)
        const i = selection ? indexOfField(doc.draft, selection) : -1
        return get().addField(type, i < 0 ? undefined : i + 1)
      },
      updateField(id, recipe, key, label = 'Edit question') {
        commit(
          label,
          (doc) => {
            const f = doc.draft.fields.find((x) => x.id === id)
            if (f) recipe(f)
          },
          key,
        )
      },
      duplicate(id) {
        let copy: string | null = null
        commit('Duplicate question', draftOf((def) => void (copy = duplicateField(def, id))))
        if (copy) set({ selection: copy })
      },
      remove(id) {
        const { doc, selection } = get()
        const i = indexOfField(doc.draft, id)
        commit('Delete question', draftOf((def) => removeField(def, id)))
        set({ pendingDelete: null })
        if (selection === id) {
          const fields = get().doc.draft.fields
          set({ selection: fields[Math.min(i, fields.length - 1)]?.id ?? null })
        }
      },
      requestDelete(id) {
        if (get().readOnly) return
        if (dependentsOf(get().doc.draft, id).length) set({ pendingDelete: id })
        else get().remove(id)
      },
      cancelDelete() {
        set({ pendingDelete: null })
      },
      move(id, to) {
        commit('Move question', draftOf((def) => moveField(def, indexOfField(def, id), to)))
      },
      moveBy(id, delta) {
        const i = indexOfField(get().doc.draft, id)
        if (i < 0) return
        get().move(id, i + delta)
      },
      setType(id, type, freshId) {
        let next: string | null = null
        commit('Change question type', draftOf((def) => void (next = changeType(def, id, type, freshId))))
        if (next && get().selection === id) set({ selection: next })
      },
      async patchSettings(patch) {
        const before = get().settings
        // Optimistic: show the change at once; the server's answer replaces it.
        const { password, webhook, ...rest } = patch
        set({
          settings: {
            ...before,
            ...rest,
            ...(webhook ? { webhook: { ...before.webhook, ...webhook } } : {}),
            ...(password !== undefined ? { hasPassword: password !== null } : {}),
          },
        })
        try {
          return await queue.patch({ settings: patch })
        } catch (err) {
          set({ settings: before })
          throw err
        }
      },
      patchSlug(slug) {
        return queue.patch({ slug })
      },
      setMeta(meta) {
        set({ meta: { ...get().meta, ...meta } })
      },
      setOthers(others) {
        set({ others })
      },
      setBanner(banner) {
        set({ banner })
      },
      flush() {
        return queue.flush()
      },
      dispose() {
        queue.dispose()
      },
    }
  })

  queue = new AutosaveQueue(
    {
      read: () => store.getState().doc,
      send: deps.send,
      debounceMs: deps.debounceMs,
      backoffMs: deps.backoffMs,
      onStatus: (status, error) =>
        store.setState((s) => ({
          save: { status, error: error ?? (status === 'error' ? s.save.error : null), savedAt: status === 'saved' ? now() : s.save.savedAt },
        })),
      onSaved: (res) => {
        const s = store.getState()
        store.setState({
          meta: { ...s.meta, slug: res.slug, status: res.status, hasUnpublished: res.hasUnpublished },
          ...(res.settings ? { settings: res.settings } : {}),
          ...(res.overwrote && res.overwrittenBy && res.overwrittenBy.id !== deps.me.id
            ? { banner: { kind: 'overwrote' as const, name: res.overwrittenBy.name } }
            : {}),
        })
      },
    },
    store.getState().doc,
    detail.revision,
  )

  return Object.assign(store, { queue })
}

// ---------------------------------------------------------------------------
// React binding
// ---------------------------------------------------------------------------

export const BuilderContext = createContext<BuilderStore | null>(null)

export function useBuilderStore(): BuilderStore {
  const store = useContext(BuilderContext)
  if (!store) throw new Error('useBuilder must be used inside the builder')
  return store
}

/** Select a slice of the builder state. Keep selectors cheap and return stable values. */
export function useBuilder<T>(selector: (s: BuilderState & BuilderActions) => T): T {
  return useStore(useBuilderStore(), selector)
}

/** Actions never change, so components can grab them without re-rendering. */
export function useActions(): BuilderActions {
  return useBuilderStore().getState()
}
