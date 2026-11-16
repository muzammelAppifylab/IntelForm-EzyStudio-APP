import { useEffect, useId, useRef, useState, type ComponentProps, type ReactNode } from 'react'
import { CircleAlert, Info } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/components/ui/cn'

/** Small building blocks for the builder's settings panels (dense, 320px wide). */

export function PanelSection({ title, description, children, className, action }: { title?: string; description?: ReactNode; children: ReactNode; className?: string; action?: ReactNode }) {
  return (
    <section className={cn('grid gap-4 border-b border-border px-4 py-5 last:border-b-0', className)}>
      {(title || action) && (
        <div className="grid gap-1">
          <div className="flex items-center justify-between gap-2">
            {title && <h3 className="text-overline text-muted-foreground">{title}</h3>}
            {action}
          </div>
          {description && <p className="text-caption text-muted-foreground">{description}</p>}
        </div>
      )}
      {children}
    </section>
  )
}

export function SwitchRow({
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
}: {
  label: string
  description?: ReactNode
  checked: boolean
  onCheckedChange(v: boolean): void
  disabled?: boolean
}) {
  const id = useId()
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="grid gap-0.5">
        <Label htmlFor={id} className="text-label">
          {label}
        </Label>
        {description && (
          <p id={`${id}-d`} className="text-caption text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        aria-describedby={description ? `${id}-d` : undefined}
        className="mt-0.5"
      />
    </div>
  )
}

/** Label + control + help + error, for one control rendered by `children(id)`. */
export function FieldRow({
  label,
  description,
  error,
  children,
  className,
}: {
  label: ReactNode
  description?: ReactNode
  error?: string | null
  children: (ids: { id: string; describedBy?: string; invalid?: boolean }) => ReactNode
  className?: string
}) {
  const id = useId()
  const describedBy = [description ? `${id}-d` : '', error ? `${id}-e` : ''].filter(Boolean).join(' ') || undefined
  return (
    <div className={cn('grid gap-1.5', className)}>
      <Label htmlFor={id} className="text-label">
        {label}
      </Label>
      {children({ id, describedBy, invalid: !!error })}
      {description && (
        <p id={`${id}-d`} className="text-caption text-muted-foreground">
          {description}
        </p>
      )}
      {error && (
        <p id={`${id}-e`} role="alert" className="flex items-center gap-1.5 text-caption text-destructive">
          <CircleAlert className="size-3.5 shrink-0" aria-hidden />
          {error}
        </p>
      )}
    </div>
  )
}

export function TextRow({
  label,
  description,
  error,
  value,
  onChange,
  multiline,
  ...rest
}: {
  label: ReactNode
  description?: ReactNode
  error?: string | null
  value: string
  onChange(v: string): void
  multiline?: boolean
} & Omit<ComponentProps<'input'>, 'value' | 'onChange'>) {
  return (
    <FieldRow label={label} description={description} error={error}>
      {({ id, describedBy, invalid }) =>
        multiline ? (
          <Textarea
            id={id}
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            disabled={rest.disabled}
            placeholder={rest.placeholder}
            maxLength={rest.maxLength}
            className="min-h-20 text-body"
          />
        ) : (
          <Input
            id={id}
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            {...rest}
            className={cn('text-body', rest.className)}
          />
        )
      }
    </FieldRow>
  )
}

/** A number box where empty means "no limit" (null). */
export function NumberRow({
  label,
  description,
  value,
  onChange,
  min,
  max,
  step,
  placeholder = 'No limit',
  disabled,
  integer = true,
}: {
  label: string
  description?: ReactNode
  value: number | null
  onChange(v: number | null): void
  min?: number
  max?: number
  step?: number
  placeholder?: string
  disabled?: boolean
  integer?: boolean
}) {
  const [text, setText] = useState(value === null ? '' : String(value))
  const last = useRef(value)
  useEffect(() => {
    if (value !== last.current) {
      last.current = value
      setText(value === null ? '' : String(value))
    }
  }, [value])
  const parsed = text.trim() === '' ? null : Number(text)
  const error =
    parsed !== null && (!Number.isFinite(parsed) || (integer && !Number.isInteger(parsed)))
      ? integer
        ? 'Enter a whole number'
        : 'Enter a number'
      : parsed !== null && min !== undefined && parsed < min
        ? `Enter ${min} or more`
        : parsed !== null && max !== undefined && parsed > max
          ? `Enter ${max} or less`
          : null
  return (
    <TextRow
      label={label}
      description={description}
      error={error}
      value={text}
      inputMode={integer ? 'numeric' : 'decimal'}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(v) => {
        setText(v)
        const n = v.trim() === '' ? null : Number(v)
        const ok = n === null || (Number.isFinite(n) && (!integer || Number.isInteger(n)) && (min === undefined || n >= min) && (max === undefined || n <= max))
        if (ok && n !== last.current) {
          last.current = n
          onChange(n)
        }
      }}
      step={step}
    />
  )
}

export function SegmentRow<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
  description,
}: {
  label: string
  value: T
  options: readonly { value: T; label: ReactNode; ariaLabel?: string }[]
  onChange(v: T): void
  disabled?: boolean
  description?: ReactNode
}) {
  const id = useId()
  return (
    <div className="grid gap-1.5">
      <span id={id} className="text-label">
        {label}
      </span>
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        aria-labelledby={id}
        value={value}
        onValueChange={(v) => v && onChange(v as T)}
        disabled={disabled}
        className="w-full"
      >
        {options.map((o) => (
          <ToggleGroupItem key={o.value} value={o.value} aria-label={o.ariaLabel} className="flex-1 text-body-sm">
            {o.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {description && <p className="text-caption text-muted-foreground">{description}</p>}
    </div>
  )
}

export function SelectRow<T extends string>({
  label,
  value,
  options,
  onChange,
  placeholder,
  disabled,
  description,
}: {
  label: string
  value: T | null
  options: readonly { value: T; label: string }[]
  onChange(v: T): void
  placeholder?: string
  disabled?: boolean
  description?: ReactNode
}) {
  return (
    <FieldRow label={label} description={description}>
      {({ id, describedBy }) => (
        <Select value={value ?? undefined} onValueChange={(v) => onChange(v as T)} disabled={disabled}>
          <SelectTrigger id={id} aria-describedby={describedBy} className="w-full text-body">
            <SelectValue placeholder={placeholder ?? 'Choose'} />
          </SelectTrigger>
          <SelectContent>
            {options.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </FieldRow>
  )
}

export function Note({ tone = 'info', children, className }: { tone?: 'info' | 'warning' | 'danger'; children: ReactNode; className?: string }) {
  const Icon = tone === 'info' ? Info : CircleAlert
  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-md px-3 py-2 text-body-sm',
        tone === 'info' && 'bg-info-subtle text-info-subtle-foreground',
        tone === 'warning' && 'bg-warning-subtle text-warning-subtle-foreground',
        tone === 'danger' && 'bg-danger-subtle text-danger-subtle-foreground',
        className,
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0">{children}</div>
    </div>
  )
}
