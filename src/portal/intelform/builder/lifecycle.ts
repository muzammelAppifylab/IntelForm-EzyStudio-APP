import { useEffect, useRef, useState } from 'react'
import type { PresenceResponse } from '../../../lib/intelform/api-builder'
import { siteFetch } from '../../../platform/browser'
import { api } from '../lib/api'
import { keepalivePatch } from './api'
import type { BuilderStore } from './store'

export const PRESENCE_INTERVAL_MS = 20_000

function newTabId(): string {
  const bytes = new Uint8Array(12)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

const TAB_KEY = (formId: string) => `intelform:presence-tab:${formId}`
const TAB_ID = /^[A-Za-z0-9_-]{8,64}$/
/** This document's tab id per form: leaving the builder and coming back in the app keeps it. */
const claimed = new Map<string, string>()

/**
 * One presence id per browser TAB, not per page load. A reload (or a hard reload) would
 * otherwise come back with a new id while the old page's row is still "live" for up to 45 s (its
 * keepalive DELETE is often lost on reload, or lands after the new page's first poll), and the
 * banner would say "You, in another tab" with no other tab open.
 *
 * The id is handed from the old page to the new one through sessionStorage (per tab, survives a
 * reload): written on pagehide, TAKEN (read and removed) on load. Because it is removed while the
 * page is open, a duplicated tab (which copies sessionStorage) does not get it and stays a
 * separate tab, as it should. Exported for tests.
 */
export function claimTabId(formId: string): string {
  const known = claimed.get(formId)
  if (known) return known
  let id: string | null = null
  try {
    id = sessionStorage.getItem(TAB_KEY(formId))
    sessionStorage.removeItem(TAB_KEY(formId))
  } catch {
    // Storage blocked: a fresh id; the stale row ages out in 45 s as before.
  }
  if (!id || !TAB_ID.test(id)) id = newTabId()
  claimed.set(formId, id)
  return id
}

/** The page is going away (reload, navigation, close): leave the id for a reload of this tab. */
export function handOverTabId(formId: string, tabId: string): void {
  try {
    sessionStorage.setItem(TAB_KEY(formId), tabId)
  } catch {
    // Storage blocked: nothing to hand over.
  }
}

/**
 * Presence: POST every 20 s while the tab is visible, DELETE (keepalive) on pagehide. The
 * answer also carries the form's revision, which is how a newer save by someone else is noticed.
 */
export function usePresence(store: BuilderStore, formId: string, meId: string | number) {
  const [tabId] = useState(() => claimTabId(formId))

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null
    let stopped = false
    const url = `/site-api/builder/forms/${encodeURIComponent(formId)}/presence`

    async function ping() {
      if (document.visibilityState !== 'visible' || stopped) return
      try {
        const res = await api<PresenceResponse>(url, { method: 'POST', body: { tabId } })
        if (stopped) return
        const s = store.getState()
        s.setOthers(res.others)
        const q = store.queue
        // Someone else saved after our last known revision, and we are not mid-save.
        if (res.revision > q.revision && !q.busy && res.updatedBy && String(res.updatedBy.id) !== String(meId) && s.banner?.kind !== 'overwrote') {
          s.setBanner({ kind: 'newer', name: res.updatedBy.name })
        }
      } catch {
        // Presence is best effort; the save status already shows connection problems.
      }
    }

    const start = () => {
      if (timer) clearInterval(timer)
      void ping()
      timer = setInterval(() => void ping(), PRESENCE_INTERVAL_MS)
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') start()
      else if (timer) {
        clearInterval(timer)
        timer = null
      }
    }
    const onPageHide = () => {
      handOverTabId(formId, tabId)
      leave()
    }
    const onPageShow = (e: PageTransitionEvent) => {
      // Back from the back/forward cache: this page is open again, so it owns the id again.
      if (e.persisted) {
        try {
          sessionStorage.removeItem(TAB_KEY(formId))
        } catch {
          // ignore
        }
      }
    }
    const leave = () => {
      void siteFetch(`${url}/${tabId}`, { method: 'DELETE', keepalive: true, credentials: 'same-origin' }).catch(() => {})
    }

    start()
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', onPageHide)
    window.addEventListener('pageshow', onPageShow)
    return () => {
      stopped = true
      if (timer) clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', onPageHide)
      window.removeEventListener('pageshow', onPageShow)
      leave()
    }
  }, [store, formId, meId, tabId])
}

/**
 * Last-chance saving: when the tab is hidden, the queue saves at once with a keepalive request
 * (it survives a tab close, and the queue still records the new revision, so nothing is sent
 * twice); on pagehide a bare keepalive PATCH covers anything left. The browser's "leave site?"
 * prompt shows only while there are unsaved changes.
 */
export function useSaveOnLeave(store: BuilderStore, formId: string) {
  useEffect(() => {
    const flush = () => {
      const q = store.queue
      const body = q.diff()
      if (!body || store.getState().readOnly) return
      if (q.busy) return // the in-flight save will be followed by one more; nothing safe to add
      keepalivePatch(formId, body, q.revision)
    }
    const onHide = () => {
      if (document.visibilityState === 'hidden' && !store.getState().readOnly && store.queue.dirty) {
        void store.queue.flush({ keepalive: true })
      }
    }
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (store.queue.dirty && !store.getState().readOnly) {
        e.preventDefault()
      }
    }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('beforeunload', onBeforeUnload)
      // Leaving the builder inside the app (router navigation): save normally. The queue is not
      // disposed here (StrictMode runs effects twice); a stray timer can only save, never lose.
      void store.getState().flush()
    }
  }, [store, formId])
}

/** True when the key event comes from somewhere that types text (inputs, TipTap, menus). */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  return !!target.closest('dialog[open],[role="dialog"],[role="menu"],[role="listbox"],[role="alertdialog"],[cmdk-root]')
}

export interface ShortcutHandlers {
  openInsert(): void
}

/** Build tab keyboard shortcuts (PRD "Editing behaviour" plus Tally's extras). */
export function useBuildShortcuts(store: BuilderStore, handlers: ShortcutHandlers) {
  const ref = useRef(handlers)
  useEffect(() => {
    ref.current = handlers
  })
  useEffect(() => {
    const focusCard = (id: string | null) =>
      requestAnimationFrame(() => {
        if (!id) return
        document.querySelector<HTMLElement>(`[data-card-id="${id}"]`)?.focus({ preventScroll: false })
      })
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isTypingTarget(e.target)) return
      const s = store.getState()
      const mod = e.metaKey || e.ctrlKey
      const key = e.key.toLowerCase()
      const fields = s.doc.draft.fields
      const sel = s.selection
      const i = sel ? fields.findIndex((f) => f.id === sel) : -1

      if (mod && key === 'z') {
        e.preventDefault()
        if (e.shiftKey) s.redo()
        else s.undo()
        return
      }
      if (mod && key === 'y') {
        e.preventDefault()
        s.redo()
        return
      }
      if (s.readOnly && !['arrowup', 'arrowdown', 'escape'].includes(key)) return

      if (mod && e.shiftKey && (key === 'arrowup' || key === 'arrowdown') && i >= 0) {
        e.preventDefault()
        s.moveBy(fields[i].id, key === 'arrowup' ? -1 : 1)
        focusCard(fields[i].id)
        return
      }
      if (mod && e.shiftKey && key === 'r' && i >= 0) {
        e.preventDefault()
        const f = fields[i]
        if (f.type !== 'section_break') s.updateField(f.id, (d) => void (d.required = !d.required), undefined, 'Toggle required')
        return
      }
      if (mod && key === 'd' && i >= 0) {
        e.preventDefault()
        s.duplicate(fields[i].id)
        focusCard(store.getState().selection)
        return
      }
      if (mod || e.altKey) return
      if (key === 'arrowdown' || key === 'arrowup') {
        if (!fields.length) return
        e.preventDefault()
        const next = i < 0 ? (key === 'arrowdown' ? 0 : fields.length - 1) : Math.max(0, Math.min(fields.length - 1, i + (key === 'arrowdown' ? 1 : -1)))
        s.select(fields[next].id)
        focusCard(fields[next].id)
        return
      }
      if ((key === 'delete' || key === 'backspace') && i >= 0) {
        e.preventDefault()
        s.requestDelete(fields[i].id)
        return
      }
      if (key === '/') {
        e.preventDefault()
        ref.current.openInsert()
        return
      }
      if (key === 'escape' && sel) s.select(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [store])
}
