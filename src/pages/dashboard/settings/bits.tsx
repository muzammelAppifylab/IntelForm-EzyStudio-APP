import { useId, type FormEvent, type ReactNode } from 'react'
import { CircleAlert, CircleCheck } from 'lucide-react'
import type { SecretState, SettingsTestResult } from '@shared/settings-app'
import { Field, FormError } from '@/components/common/Field'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'

/** A card holding one settings group with its own Save button. */
export function GroupCard({
  title,
  description,
  children,
  onSubmit,
  dirty,
  saving,
  formError,
  readOnly,
  saveLabel = 'Save',
  footer,
}: {
  title: string
  description?: string
  children: ReactNode
  onSubmit?: () => void
  dirty?: boolean
  saving?: boolean
  formError?: string | null
  readOnly?: boolean
  saveLabel?: string
  footer?: ReactNode
}) {
  const id = useId()
  function submit(e: FormEvent) {
    e.preventDefault()
    onSubmit?.()
  }
  return (
    <Card aria-labelledby={`${id}-title`} role="region">
      <CardHeader>
        <CardTitle id={`${id}-title`} className="text-subheading">
          {title}
        </CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <form onSubmit={submit} noValidate className="contents">
        <CardContent className="grid gap-5">
          <FormError message={formError ?? null} />
          {children}
        </CardContent>
        {(onSubmit || footer) && !readOnly && (
          <CardFooter className="flex flex-wrap items-center gap-3 border-t border-border pt-6">
            {onSubmit && (
              <Button type="submit" disabled={saving || dirty === false}>
                {saving ? 'Saving…' : saveLabel}
              </Button>
            )}
            {footer}
            {dirty && <span className="text-caption text-muted-foreground">Unsaved changes</span>}
          </CardFooter>
        )}
      </form>
    </Card>
  )
}

/** Label and help text on the left, a switch on the right. */
export function SwitchRow({
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
}: {
  label: string
  description?: string
  checked: boolean
  onCheckedChange: (v: boolean) => void
  disabled?: boolean
}) {
  const id = useId()
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="grid gap-0.5">
        <label htmlFor={id} className="text-label">
          {label}
        </label>
        {description && (
          <p id={`${id}-d`} className="text-caption text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} aria-describedby={description ? `${id}-d` : undefined} className="mt-0.5" />
    </div>
  )
}

/**
 * A write-only secret. The browser only knows whether one is stored. `value`: undefined keeps
 * the stored secret, a string replaces it, null removes it on save.
 */
export function SecretField({
  label,
  description,
  state,
  value,
  onChange,
  error,
  autoComplete = 'off',
}: {
  label: string
  description?: string
  state: SecretState
  value: string | null | undefined
  onChange: (v: string | null | undefined) => void
  error?: string
  autoComplete?: string
}) {
  const removing = value === null
  return (
    <Field label={label} description={description} error={error}>
      {(p) => (
        <div className="grid gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              {...p}
              type="password"
              autoComplete={autoComplete}
              spellCheck={false}
              disabled={removing}
              value={value ?? ''}
              placeholder={state.set ? 'Saved. Type a new value to replace it' : 'Paste the key'}
              onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
              className="font-mono sm:max-w-sm"
            />
            <Badge variant={state.set && !removing ? 'success' : 'muted'}>{state.set && !removing ? 'Set' : 'Not set'}</Badge>
            {state.set &&
              (removing ? (
                <Button type="button" variant="ghost" size="sm" onClick={() => onChange(undefined)}>
                  Keep it
                </Button>
              ) : (
                <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
                  Remove<span className="sr-only"> {label.toLowerCase()}</span>
                </Button>
              ))}
          </div>
          {removing && <p className="text-caption text-muted-foreground">It will be removed when you save.</p>}
        </div>
      )}
    </Field>
  )
}

/** Result of a Test button, announced politely. */
export function TestResult({ result }: { result: SettingsTestResult | null | undefined }) {
  if (!result) return null
  return (
    <Alert variant={result.ok ? 'success' : 'destructive'} role="status">
      {result.ok ? <CircleCheck aria-hidden /> : <CircleAlert aria-hidden />}
      <AlertDescription className={result.ok ? 'text-success-subtle-foreground' : 'text-danger-subtle-foreground'}>{result.message}</AlertDescription>
    </Alert>
  )
}
