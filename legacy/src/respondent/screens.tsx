import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { ArrowRight, Clock, Lock } from 'lucide-react'
import type { EndScreen, StartScreen as StartScreenDef } from '@shared/form/definition'
import { formatLabel, type Labels } from '@shared/form/labels'
import { FieldError } from '@/components/ds/FieldError'
import { clsx } from 'clsx'
import { FormButton, TextInput } from './ui'

/** Start, end, closed, not-found and password screens. Each moves focus to its heading. */

function useFocusOnMount(on: boolean) {
  const ref = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    if (on) ref.current?.focus({ preventScroll: true })
  }, [on])
  return ref
}

function Screen({ center, children, className }: { center: boolean; children: ReactNode; className?: string }) {
  return (
    <div className="flex flex-1 items-center px-4 py-12 @lg:px-8 @lg:py-16">
      <div className={clsx('mx-auto grid w-full max-w-(--question-width) gap-6', center && 'justify-items-center text-center', className)}>{children}</div>
    </div>
  )
}

export function StartScreen({
  screen,
  labels,
  center,
  focus,
  onStart,
}: {
  screen: StartScreenDef
  labels: Labels
  center: boolean
  focus: boolean
  onStart: () => void
}) {
  const ref = useFocusOnMount(focus)
  const minutes = screen.minutes ? (screen.minutes === 1 ? labels.minutesOne : formatLabel(labels.minutes, { n: screen.minutes })) : null
  return (
    <Screen center={center}>
      {screen.imageUrl && (
        <img
          src={screen.imageUrl}
          alt={screen.imageAlt ?? ''}
          fetchPriority="high"
          className="max-h-72 w-auto max-w-full rounded-[min(var(--form-radius,var(--radius)),1rem)] object-cover"
        />
      )}
      <h1 ref={ref} tabIndex={-1} className="text-question-xl text-foreground outline-none">
        {screen.title || ' '}
      </h1>
      {screen.description && <p className="max-w-prose text-answer text-muted-foreground whitespace-pre-line">{screen.description}</p>}
      <div className={clsx('flex flex-wrap items-center gap-4', center && 'justify-center')}>
        <FormButton type="button" onClick={onStart}>
          {screen.button || labels.start}
          <ArrowRight aria-hidden />
        </FormButton>
        {minutes && (
          <span className="inline-flex items-center gap-1.5 text-body text-muted-foreground">
            <Clock aria-hidden className="size-4" />
            {minutes}
          </span>
        )}
      </div>
    </Screen>
  )
}

export function EndScreenView({
  screen,
  labels,
  pipe,
  center,
  embedded,
}: {
  screen: EndScreen
  labels: Labels
  pipe: (t: string | undefined) => string
  center: boolean
  embedded?: boolean
}) {
  const ref = useFocusOnMount(true)
  const title = pipe(screen.title).trim() || labels.thanks
  const message = pipe(screen.message).trim()
  return (
    <Screen center={center}>
      <h1 ref={ref} tabIndex={-1} className="text-question-xl text-foreground outline-none">
        {title}
      </h1>
      {message && <p className="max-w-prose text-answer text-muted-foreground whitespace-pre-line">{message}</p>}
      {screen.button && (
        <FormButton asChild>
          <a href={screen.button.url} target={embedded ? '_blank' : '_top'} rel="noopener noreferrer">
            {screen.button.label}
            <ArrowRight aria-hidden />
          </a>
        </FormButton>
      )}
    </Screen>
  )
}

/** Closed form, unknown link, already responded. */
export function MessageScreen({ title, message, center, focus = true }: { title: string; message?: string; center: boolean; focus?: boolean }) {
  const ref = useFocusOnMount(focus)
  return (
    <Screen center={center}>
      <h1 ref={ref} tabIndex={-1} className="text-question-xl text-foreground outline-none">
        {title}
      </h1>
      {message && <p className="max-w-prose text-answer text-muted-foreground whitespace-pre-line">{message}</p>}
    </Screen>
  )
}

export function PasswordGate({
  title,
  labels,
  center,
  onUnlock,
}: {
  title: string
  labels: Labels
  center: boolean
  /** Resolves to an error message, or null when unlocked. */
  onUnlock: (password: string) => Promise<string | null>
}) {
  const ref = useFocusOnMount(true)
  const id = useId()
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!password) return setError(labels.wrongPassword)
    setBusy(true)
    const err = await onUnlock(password).catch(() => labels.submitError)
    setBusy(false)
    setError(err)
  }
  return (
    <Screen center={center}>
      <Lock aria-hidden className="size-8 text-[color:var(--form-answer,var(--primary))]" />
      <h1 ref={ref} tabIndex={-1} className="text-question-xl text-foreground outline-none">
        {title}
      </h1>
      <form onSubmit={submit} noValidate className="grid w-full max-w-md gap-3 text-left">
        <label htmlFor={id} className="text-answer text-muted-foreground">
          {labels.passwordPrompt}
        </label>
        <TextInput
          id={id}
          type="password"
          autoComplete="current-password"
          invalid={!!error}
          aria-describedby={error ? `${id}-err` : undefined}
          value={password}
          onValueChange={setPassword}
        />
        {error && <FieldError id={`${id}-err`}>{error}</FieldError>}
        <FormButton type="submit" disabled={busy} className="w-fit">
          {labels.unlock}
          <ArrowRight aria-hidden />
        </FormButton>
      </form>
    </Screen>
  )
}
