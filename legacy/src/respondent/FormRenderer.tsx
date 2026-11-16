import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { FormDefinition } from '@shared/form/definition'
import { validateSubmission } from '@shared/form/logic'
import type { StepSound } from '@shared/form/settings'
import type { FormTheme } from '@shared/form/theme'
import { TtcClock, useFormEngine } from './engine'
import { AllAtOnce } from './layouts/AllAtOnce'
import type { FormErrorAction, LayoutContext, SubmitOutcome } from './layouts/context'
import { OneAtATime } from './layouts/OneAtATime'
import { Paged } from './layouts/Paged'
import { redirectAfterSubmit } from './redirect'
import { playStepSound } from './sound'
import { EndScreenView, StartScreen } from './screens'
import { FormShell } from './Shell'
import './extras.css'

/**
 * Respondent renderer: one definition, three layouts (all at once, section by section, one at
 * a time), live show/hide logic, piping, start and end screens. Used by the public form
 * (mode "live") and the builder preview (mode "preview": no network, submit shows the end screen).
 *
 * Sizing uses container queries, never viewport units, except `embed`-less live pages which fill
 * 100dvh; so the same component works inside the builder's preview frame.
 */
export type SubmitResult =
  | { ok: true; redirectUrl?: string }
  | { ok: false; errors: Record<string, string>; message?: string; action?: FormErrorAction }

export interface FormRendererProps {
  definition: FormDefinition
  theme: FormTheme
  /** preview: no network, no Turnstile; submit just shows the end screen. */
  mode: 'live' | 'preview'
  /** Width hint for the builder preview (mobile also turns off input autofocus). */
  device?: 'desktop' | 'mobile'
  /** Sound on moving to the next question or section, and on submit (form setting). */
  stepSound?: StepSound
  onSubmit?: (answers: Record<string, unknown>, meta: { startedAt: number; ttc: Record<string, number> }) => Promise<SubmitResult>

  // Live-page extras (optional; the builder preview leaves them out)
  /** Form title: the page's h1 (visible in the all-at-once layout) and document.title. */
  title?: string
  /** Embedded in an iframe: `inline` takes content height, `popup` fills the dialog. */
  embed?: 'inline' | 'popup' | null
  hideTitle?: boolean
  transparent?: boolean
  /** Called once, on Start or the first answer (funnel "start"). */
  onStart?: () => void
  /** Keep document.title as "Question 3 of 8 – Title" (live pages only). */
  manageDocumentTitle?: boolean
  /** Rendered at the end of the form (the Turnstile widget). */
  footer?: ReactNode
  /** Answers to start from (read on mount), e.g. kept across a reload after the form was republished. Skips the start screen. */
  initialAnswers?: Record<string, unknown> | null
}

function isDesktop(device?: 'desktop' | 'mobile'): boolean {
  if (device === 'mobile') return false
  if (device === 'desktop') return true
  try {
    return matchMedia('(hover: hover) and (pointer: fine)').matches
  } catch {
    return true
  }
}

export function FormRenderer(props: FormRendererProps) {
  const { definition: def, theme, mode, device, onSubmit, title, embed, manageDocumentTitle } = props
  const preview = mode === 'preview'
  const engine = useFormEngine(def, props.initialAnswers)
  const ttc = useMemo(() => new TtcClock(), [])
  const [phase, setPhase] = useState<'start' | 'form' | 'end'>(def.startScreen.enabled && !props.initialAnswers ? 'start' : 'form')
  const shownPhase = phase === 'start' && !def.startScreen.enabled ? 'form' : phase
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [formErrorAction, setFormErrorAction] = useState<FormErrorAction | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const startedAt = useRef<number | null>(null)
  const interacted = useRef(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const focusInputs = useMemo(() => isDesktop(device), [device])
  const center = theme.alignment === 'center'
  const onStartRef = useRef(props.onStart)
  onStartRef.current = props.onStart

  const setTitle = useCallback(
    (prefix: string | null, error = false) => {
      if (!manageDocumentTitle || preview) return
      const base = title ?? document.title
      document.title = `${error ? `${engine.labels.errorTitle}: ` : ''}${prefix ? `${prefix} – ` : ''}${base}`
    },
    [manageDocumentTitle, preview, title, engine.labels.errorTitle],
  )

  const markStarted = useCallback(() => {
    interacted.current = true
    if (startedAt.current !== null) return
    startedAt.current = Date.now()
    onStartRef.current?.()
  }, [])

  const submit = async (): Promise<SubmitOutcome> => {
    const ids = engine.pages.flat()
    const errs = engine.check(ids)
    if (Object.keys(errs).length) {
      engine.showErrors(errs)
      return { ok: false, errors: errs }
    }
    const final = validateSubmission(def, engine.pruned, { context: { dayTolerance: 0 }, hidden: 'drop' })
    if (!final.ok) {
      engine.showErrors(final.errors)
      return { ok: false, errors: final.errors }
    }
    ttc.leave()
    if (preview || !onSubmit) {
      playStepSound(props.stepSound ?? 'off', true)
      setPhase('end')
      return { ok: true }
    }
    setSubmitting(true)
    setFormError(null)
    setFormErrorAction(null)
    try {
      const r = await onSubmit(final.answers, { startedAt: startedAt.current ?? Date.now(), ttc: ttc.snapshot() })
      if (r.ok) {
        playStepSound(props.stepSound ?? 'off', true)
        if (r.redirectUrl) {
          redirectAfterSubmit(r.redirectUrl, def.fields.map((f) => f.id), !!embed)
          if (!embed) return { ok: true }
        }
        setPhase('end')
        return { ok: true }
      }
      if (Object.keys(r.errors).length) engine.showErrors(r.errors)
      else {
        setFormError(r.message ?? engine.labels.submitError)
        setFormErrorAction(r.action ?? null)
      }
      return { ok: false, errors: r.errors }
    } catch {
      setFormError(engine.labels.submitError)
      return { ok: false, errors: {} }
    } finally {
      setSubmitting(false)
    }
  }

  useEffect(() => {
    if (shownPhase === 'end') {
      setStatus(null)
      setTitle(null)
    }
    if (shownPhase === 'start') setTitle(null)
  }, [shownPhase, setTitle])

  const ctx: LayoutContext = {
    engine,
    ttc,
    preview,
    focusInputs,
    allowFocus: () => !preview || interacted.current,
    title,
    hideTitle: props.hideTitle,
    center,
    submitting,
    formError,
    formErrorAction,
    submit,
    playStep: () => playStepSound(props.stepSound ?? 'off'),
    markStarted,
    announce: (s, opts) => {
      setStatus(s)
      setTitle(s, opts?.error)
    },
    scrollTop: () => {
      if (preview || embed) rootRef.current?.scrollIntoView({ block: 'start' })
      else window.scrollTo({ top: 0 })
    },
  }

  const shellMode = preview ? 'preview' : embed === 'inline' ? 'embed' : 'page'

  return (
    <FormShell theme={theme} mode={shellMode} transparent={props.transparent} device={device}>
      <div
        ref={rootRef}
        role={preview ? undefined : 'main'}
        className={'flex flex-1 flex-col' + (shellMode === 'embed' && def.layout === 'one_at_a_time' ? ' min-h-[34rem]' : '')}
      >
        {shownPhase === 'start' && (
          <StartScreen
            screen={def.startScreen}
            labels={engine.labels}
            center={center}
            focus={!preview}
            onStart={() => {
              markStarted()
              setPhase('form')
            }}
          />
        )}
        {shownPhase === 'form' && def.layout === 'one_at_a_time' && <OneAtATime ctx={ctx} fixedNav={shellMode === 'page'} />}
        {shownPhase === 'form' && def.layout === 'section_by_section' && <Paged ctx={ctx} />}
        {shownPhase === 'form' && def.layout === 'all_at_once' && <AllAtOnce ctx={ctx} />}
        {shownPhase === 'end' && (
          <EndScreenView
            screen={def.endScreen}
            labels={engine.labels}
            pipe={engine.pipe}
            center={center}
            embedded={!!embed}
          />
        )}
        {props.footer}
      </div>
      <p aria-live="polite" className="sr-only">
        {status}
      </p>
    </FormShell>
  )
}
