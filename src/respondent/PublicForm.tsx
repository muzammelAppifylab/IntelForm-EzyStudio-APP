import { lazy, Suspense, useEffect, useId, useMemo, useRef, useState, type RefObject } from 'react'
import type { PublicFormLive, PublicFormResponse } from '@shared/api-public'
import { SYSTEM_LABELS } from '@shared/form/labels'
import { defaultTheme } from '@shared/form/theme-core'
import { fetchForm, PublicApiError, rememberBrowserToken, sendEvent, sessionToken, storedBrowserToken, submitResponse, unlockForm } from './api'
import { FormRenderer, type SubmitResult } from './FormRenderer'
import type { TurnstileHandle } from './lazy/Turnstile'
import { MessageScreen, PasswordGate } from './screens'
import { FormShell } from './Shell'

const TurnstileWidget = lazy(() => import('./lazy/Turnstile'))

/**
 * The public form at /f/:slug: loads (or reads the inlined) form JSON, then shows the password
 * gate, the closed message, a 404, or the live form wired to the submit API, the funnel events,
 * Turnstile and one-response-per-browser. Embedding: `?embed=1` (inline, posts its height to
 * the parent), `?embed=popup`, `&transparent=1`, `&hideTitle=1`.
 */
export type Loaded = PublicFormResponse | { status: 'missing' } | { status: 'error' }

export interface EmbedOptions {
  embed: 'inline' | 'popup' | null
  transparent: boolean
  hideTitle: boolean
}

export function embedOptions(search: string): EmbedOptions {
  const q = new URLSearchParams(search)
  const e = q.get('embed')
  return {
    embed: e === 'popup' ? 'popup' : e ? 'inline' : null,
    transparent: q.get('transparent') === '1',
    hideTitle: q.get('hideTitle') === '1',
  }
}

export function PublicForm({ slug: initialSlug, initial, search }: { slug: string; initial?: Loaded | null; search: string }) {
  const [slug, setSlug] = useState(initialSlug)
  const [data, setData] = useState<Loaded | null>(initial ?? null)
  const unlock = useRef<string | null>(null)
  /** Answers kept across a reload after the form was republished (version_unknown on submit). */
  const carried = useRef<Record<string, unknown> | null>(null)
  const opts = useMemo(() => embedOptions(search), [search])

  useEffect(() => {
    if (data && data.status !== 'moved') return
    if (data?.status === 'moved') {
      const next = data.redirectTo
      try {
        history.replaceState(null, '', `/f/${next}${location.search}`)
      } catch {
        // sandboxed
      }
      setSlug(next)
      setData(null)
      return
    }
    let alive = true
    fetchForm(slug, unlock.current)
      .then((d) => alive && setData(d))
      .catch((err) => alive && setData({ status: err instanceof PublicApiError && err.status === 404 ? 'missing' : 'error' }))
    return () => {
      alive = false
    }
  }, [slug, data])

  // <html lang> and the tab title.
  useEffect(() => {
    if (!data || !('lang' in data)) return
    document.documentElement.lang = data.lang
    document.title = data.settings.seoTitle || data.title
  }, [data])

  useEmbedBridge(opts.embed)

  if (!data) return <div aria-busy="true" className="min-h-dvh" />
  if (data.status === 'moved') return null
  if (data.status === 'missing' || data.status === 'error') {
    const missing = data.status === 'missing'
    return (
      <FormShell theme={defaultTheme()} mode={opts.embed === 'inline' ? 'embed' : 'page'}>
        <div role="main" className="flex flex-1 flex-col">
          <MessageScreen
            center={false}
            title={missing ? SYSTEM_LABELS.formMissingTitle : SYSTEM_LABELS.loadErrorTitle}
            message={missing ? SYSTEM_LABELS.formMissing : SYSTEM_LABELS.loadError}
          />
        </div>
      </FormShell>
    )
  }

  const shellMode = opts.embed === 'inline' ? 'embed' : 'page'
  const center = data.theme.alignment === 'center'
  if (data.status === 'closed') {
    return (
      <FormShell theme={data.theme} mode={shellMode} transparent={opts.transparent}>
        <div role="main" className="flex flex-1 flex-col">
          <MessageScreen center={center} title={data.message} />
        </div>
      </FormShell>
    )
  }
  if (data.status === 'locked') {
    return (
      <FormShell theme={data.theme} mode={shellMode} transparent={opts.transparent}>
        <div role="main" className="flex flex-1 flex-col">
          <PasswordGate
            title={data.title}
            labels={data.labels}
            center={center}
            onUnlock={async (password) => {
              try {
                const r = await unlockForm(slug, password)
                unlock.current = r.token
                setData(r.form)
                return null
              } catch (err) {
                return err instanceof PublicApiError ? (err.fields.password?.[0] ?? err.message) : data.labels.submitError
              }
            }}
          />
        </div>
      </FormShell>
    )
  }
  return (
    <LiveForm
      key={data.versionId}
      form={data}
      slug={slug}
      opts={opts}
      unlockToken={unlock}
      initialAnswers={carried.current}
      onLocked={() => setData(null)}
      onOutdated={(answers) => {
        // Refetch the latest version in place (setData(null) reloads it) and start from these answers.
        carried.current = answers
        setData(null)
      }}
    />
  )
}

function LiveForm({
  form,
  slug,
  opts,
  unlockToken,
  initialAnswers,
  onLocked,
  onOutdated,
}: {
  form: PublicFormLive
  slug: string
  opts: EmbedOptions
  unlockToken: RefObject<string | null>
  initialAnswers: Record<string, unknown> | null
  onLocked: () => void
  onOutdated: (answers: Record<string, unknown>) => void
}) {
  const labels = form.labels
  const turnstile = useRef<TurnstileHandle>(null)
  const renderToken = form.renderToken
  const already = form.settings.onePerBrowser ? storedBrowserToken(form.id) : null
  const browserToken = useMemo(() => storedBrowserToken(form.id) ?? crypto.randomUUID(), [form.id])
  const [closed, setClosed] = useState<string | null>(null)

  useEffect(() => {
    sendEvent(slug, 'view', sessionToken(form.id))
  }, [slug, form.id])

  if (already) {
    return (
      <FormShell theme={form.theme} mode={opts.embed === 'inline' ? 'embed' : 'page'} transparent={opts.transparent}>
        <div role="main" className="flex flex-1 flex-col">
          <MessageScreen center={form.theme.alignment === 'center'} title={labels.alreadyResponded} />
        </div>
      </FormShell>
    )
  }
  if (closed) {
    return (
      <FormShell theme={form.theme} mode={opts.embed === 'inline' ? 'embed' : 'page'} transparent={opts.transparent}>
        <div role="main" className="flex flex-1 flex-col">
          <MessageScreen center={form.theme.alignment === 'center'} title={closed} />
        </div>
      </FormShell>
    )
  }

  const onSubmit = async (answers: Record<string, unknown>, meta: { startedAt: number; ttc: Record<string, number> }): Promise<SubmitResult> => {
    let turnstileToken: string | undefined
    if (form.turnstileSiteKey) {
      try {
        turnstileToken = await turnstile.current?.getToken()
      } catch {
        turnstile.current?.reset()
        return { ok: false, errors: {}, message: labels.humanCheckFailed }
      }
    }
    // A honeypot input exists in the DOM for bots that fill every field.
    const hp = (document.querySelector<HTMLInputElement>('input[data-if-hp]')?.value ?? '').slice(0, 2000)
    try {
      const r = await submitResponse(slug, {
        formVersionId: form.versionId,
        answers,
        startedAt: meta.startedAt,
        ttc: meta.ttc,
        renderToken,
        hp: hp || undefined,
        turnstileToken,
        unlockToken: unlockToken.current ?? undefined,
        browserToken,
      })
      if (form.settings.onePerBrowser) rememberBrowserToken(form.id, browserToken)
      return { ok: true, redirectUrl: r.redirectUrl }
    } catch (err) {
      turnstile.current?.reset()
      if (!(err instanceof PublicApiError)) return { ok: false, errors: {}, message: labels.submitError }
      if (err.code === 'validation_failed' && Object.keys(err.fields).length) {
        return { ok: false, errors: Object.fromEntries(Object.entries(err.fields).map(([k, v]) => [k, v?.[0] ?? labels.invalid])) }
      }
      if (err.code === 'form_closed') setClosed(err.message)
      if (err.code === 'locked') onLocked()
      if (err.code === 'version_unknown') {
        // The form was republished and the server no longer accepts this version: offer a reload
        // that keeps the answers in memory.
        return { ok: false, errors: {}, message: labels.formUpdated, action: { label: labels.reload, run: () => onOutdated(answers) } }
      }
      return { ok: false, errors: {}, message: err.status === 0 ? labels.submitError : err.message }
    }
  }

  return (
    <FormRenderer
      definition={form.definition}
      theme={form.theme}
      labels={form.settings.labels}
      mode="live"
      title={form.title}
      embed={opts.embed}
      hideTitle={opts.hideTitle}
      transparent={opts.transparent}
      manageDocumentTitle
      onStart={() => sendEvent(slug, 'start', sessionToken(form.id))}
      onSubmit={onSubmit}
      initialAnswers={initialAnswers}
      footer={
        <>
          <Honeypot />
          {form.turnstileSiteKey && (
            <Suspense fallback={null}>
              <TurnstileWidget ref={turnstile} siteKey={form.turnstileSiteKey} lang={form.lang} />
            </Suspense>
          )}
        </>
      }
    />
  )
}

/** Off-screen bait field: hidden from people and assistive tech, filled by naive bots. */
function Honeypot() {
  const name = `website_${useId().replace(/[^a-z0-9]/gi, '')}`
  return (
    <div aria-hidden="true" className="pointer-events-none absolute -left-[9999px] h-px w-px overflow-hidden opacity-0">
      <label>
        Leave this empty
        <input data-if-hp type="text" name={name} tabIndex={-1} autoComplete="off" defaultValue="" />
      </label>
    </div>
  )
}

/**
 * Inside an iframe: post our height to the parent (`?embed=1`) so embed.js can size the frame,
 * and ask it to close on Escape (`?embed=popup`). We only ever send a height or "close": the
 * host page is unknown, so the message goes to '*' and carries nothing else.
 */
function useEmbedBridge(embed: EmbedOptions['embed']) {
  useEffect(() => {
    if (!embed || window.parent === window) return
    const post = (msg: object) => window.parent.postMessage(msg, '*')
    let ro: ResizeObserver | null = null
    if (embed === 'inline') {
      const root = document.getElementById('root') ?? document.body
      let last = 0
      ro = new ResizeObserver(() => {
        const height = Math.ceil(root.getBoundingClientRect().height)
        if (height !== last) {
          last = height
          post({ type: 'intelform:resize', height })
        }
      })
      ro.observe(root)
    }
    const onKey = (e: KeyboardEvent) => {
      if (embed === 'popup' && e.key === 'Escape' && !e.defaultPrevented) post({ type: 'intelform:close' })
    }
    document.addEventListener('keydown', onKey)
    return () => {
      ro?.disconnect()
      document.removeEventListener('keydown', onKey)
    }
  }, [embed])
}

