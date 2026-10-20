import type { FormPatchInput, FormPatchResponse } from '@shared/api-forms'
import type { FormDefinition } from '@shared/form/definition'
import type { FormTheme } from '@shared/form/theme'

/** What the undo history and autosave track: the title, the draft and the theme. */
export interface Doc {
  title: string
  draft: FormDefinition
  theme: FormTheme
}

export type SaveStatus = 'saved' | 'pending' | 'saving' | 'offline' | 'error'

/** A failed request. `status` 0 means the network was unreachable. */
export interface SaveError {
  status: number
  message: string
  fields?: Record<string, string[] | undefined>
}

export interface AutosaveDeps {
  /** The current document. */
  read(): Doc
  /** Sends one PATCH with `If-Match: "<revision>"`. Rejects with a SaveError. */
  send(body: FormPatchInput, revision: number): Promise<FormPatchResponse>
  onStatus(status: SaveStatus, error?: SaveError): void
  onSaved(res: FormPatchResponse, body: FormPatchInput): void
  debounceMs?: number
  /** Retry delays for network and server errors: 2, 4, 8, 16, 30, 30… seconds. */
  backoffMs?: (attempt: number) => number
}

interface Extra {
  body: FormPatchInput
  resolve: (res: FormPatchResponse) => void
  reject: (err: SaveError) => void
}

export const defaultBackoff = (attempt: number) => Math.min(30_000, 2000 * 2 ** attempt)

/**
 * Single-flight autosave (docs/research/02-builder.md "State, autosave and undo"):
 * - a document change schedules a save `debounceMs` (1 s) after the last change;
 * - only one request is in flight; changes made meanwhile cause exactly one more save;
 * - network and 5xx errors retry with backoff and show Offline; a 4xx shows the error and
 *   waits for the next change;
 * - settings and slug changes ("extras") ride the same queue, one request each, so revisions
 *   stay in order, and resolve or reject their own promise.
 */
export class AutosaveQueue {
  revision: number
  private saved: Doc
  private extras: Extra[] = []
  private timer: ReturnType<typeof setTimeout> | null = null
  private inFlight: Promise<void> | null = null
  private again = false
  private attempt = 0
  private failed = false
  private disposed = false

  private deps: AutosaveDeps

  constructor(deps: AutosaveDeps, initial: Doc, revision: number) {
    this.deps = deps
    this.saved = initial
    this.revision = revision
  }

  /** The body that would bring the server up to date, or null when nothing changed. */
  diff(): FormPatchInput | null {
    const doc = this.deps.read()
    const body: FormPatchInput = {}
    if (doc.title !== this.saved.title && doc.title.trim()) body.title = doc.title
    if (doc.draft !== this.saved.draft) body.draft = doc.draft as unknown as Record<string, unknown>
    if (doc.theme !== this.saved.theme) body.theme = doc.theme as unknown as Record<string, unknown>
    return Object.keys(body).length ? body : null
  }

  get dirty(): boolean {
    return this.diff() !== null || this.extras.length > 0
  }

  get busy(): boolean {
    return this.inFlight !== null
  }

  /** Call after every document change. */
  changed(): void {
    this.failed = false
    this.attempt = 0
    if (!this.inFlight) this.deps.onStatus('pending')
    this.schedule(this.deps.debounceMs ?? 1000)
  }

  /** Settings or slug: saved soon, through the same queue. */
  patch(body: FormPatchInput): Promise<FormPatchResponse> {
    return new Promise((resolve, reject) => {
      // Settings typed in quick succession merge into the waiting request.
      const last = this.extras.at(-1)
      if (last && onlySettings(last.body) && onlySettings(body)) {
        const a = last.body.settings!
        const b = body.settings!
        last.body = { settings: { ...a, ...b, ...(a.webhook && b.webhook ? { webhook: { ...a.webhook, ...b.webhook } } : {}) } }
        const prev = { resolve: last.resolve, reject: last.reject }
        last.resolve = (r) => (prev.resolve(r), resolve(r))
        last.reject = (e) => (prev.reject(e), reject(e))
      } else {
        this.extras.push({ body, resolve, reject })
      }
      this.schedule(this.inFlight ? 0 : 150)
    })
  }

  /** Saves now and resolves once nothing is left to save (or a save failed). */
  async flush(): Promise<void> {
    this.clearTimer()
    for (let i = 0; i < 20 && this.dirty && !this.disposed; i++) {
      this.clearTimer()
      await this.run()
      if (this.failed) return
    }
    if (this.inFlight) await this.inFlight
  }

  /** Called after a publish or reload: the server's revision moved on without a PATCH. */
  rebase(revision: number, doc?: Doc): void {
    this.revision = revision
    if (doc) this.saved = doc
  }

  dispose(): void {
    this.disposed = true
    this.clearTimer()
  }

  private clearTimer() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  private schedule(ms: number) {
    if (this.disposed) return
    this.clearTimer()
    this.timer = setTimeout(() => {
      this.timer = null
      void this.run()
    }, ms)
  }

  private run(): Promise<void> {
    if (this.inFlight) {
      this.again = true
      return this.inFlight
    }
    const extra = this.extras.shift()
    const docBody = extra ? null : this.diff()
    if (!extra && !docBody) {
      this.deps.onStatus(this.failed ? 'error' : 'saved')
      return Promise.resolve()
    }
    const body = extra ? extra.body : docBody!
    const sentDoc = this.deps.read()
    this.deps.onStatus('saving')
    this.inFlight = (async () => {
      try {
        const res = await this.deps.send(body, this.revision)
        this.revision = res.revision
        if (!extra) this.saved = { ...this.saved, ...pick(sentDoc, body) }
        this.attempt = 0
        this.failed = false
        extra?.resolve(res)
        this.deps.onSaved(res, body)
      } catch (raw) {
        const err = toSaveError(raw)
        if (extra) {
          extra.reject(err)
        } else if (err.status === 0 || err.status >= 500 || err.status === 429) {
          this.deps.onStatus('offline', err)
          const delay = (this.deps.backoffMs ?? defaultBackoff)(this.attempt++)
          this.inFlight = null
          this.schedule(delay)
          this.failed = true
          return
        } else {
          this.failed = true
          this.deps.onStatus('error', err)
          this.inFlight = null
          return
        }
      }
      this.inFlight = null
      const more = this.again || this.extras.length > 0 || (!this.failed && this.diff() !== null)
      this.again = false
      if (more && !this.disposed) {
        // A change arrived while saving: one more save, right away if extras wait, else debounced.
        if (this.extras.length) this.schedule(0)
        else if (!this.timer) this.schedule(this.deps.debounceMs ?? 1000)
        this.deps.onStatus('pending')
      } else {
        this.deps.onStatus('saved')
      }
    })()
    return this.inFlight
  }
}

function onlySettings(body: FormPatchInput): boolean {
  return body.settings !== undefined && Object.keys(body).length === 1
}

function pick(doc: Doc, body: FormPatchInput): Partial<Doc> {
  const out: Partial<Doc> = {}
  if (body.title !== undefined) out.title = doc.title
  if (body.draft !== undefined) out.draft = doc.draft
  if (body.theme !== undefined) out.theme = doc.theme
  return out
}

export function toSaveError(raw: unknown): SaveError {
  if (raw && typeof raw === 'object' && 'status' in raw && typeof (raw as SaveError).status === 'number') {
    const e = raw as SaveError
    return { status: e.status, message: e.message, fields: e.fields }
  }
  return { status: 0, message: raw instanceof Error ? raw.message : 'Can’t reach the server' }
}
